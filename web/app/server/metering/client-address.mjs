// The caller's real network address behind Cloudflare and the ingress, for per-address limits.
// Pure apart from node:net.
//
// The ingress writes the last X-Forwarded-For entry (HTTP_FORWARDED_COUNT=1: the address that
// reached it). On the Cloud that is a Cloudflare edge, shared by many people. Cloudflare writes
// the visitor's address just before its own, so walking left past Cloudflare's own addresses
// finds the visitor; an entry a caller wrote themselves is never reached, because it sits to
// the left of an address Cloudflare or the ingress wrote. When no address other than
// Cloudflare's is known, the result is a Cloudflare address, and per-address limits skip it
// (limits.mjs) instead of counting everyone behind that edge as one caller.
import { BlockList, isIP } from 'node:net'

// https://www.cloudflare.com/ips/ (read 2026-11-20)
const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14',
  '172.64.0.0/13', '131.0.72.0/22']
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']

const cloudflare = new BlockList()
for (const range of CLOUDFLARE_V4) { const [net, bits] = range.split('/'); cloudflare.addSubnet(net, Number(bits), 'ipv4') }
for (const range of CLOUDFLARE_V6) { const [net, bits] = range.split('/'); cloudflare.addSubnet(net, Number(bits), 'ipv6') }

// The cluster's own addresses: the ingress, a node, a pod, this machine. With no forwarded count (or a
// hop that rewrote it), Meteor's address for every visitor is the ingress's, so one of these would put
// every guest in one per-address count: it is not a caller's address, and is not counted (as an edge's).
const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', '0.0.0.0/8']
const PRIVATE_V6 = ['::1/128', 'fc00::/7', 'fe80::/10', '::/128']
const privateRanges = new BlockList()
for (const range of PRIVATE_V4) { const [net, bits] = range.split('/'); privateRanges.addSubnet(net, Number(bits), 'ipv4') }
for (const range of PRIVATE_V6) { const [net, bits] = range.split('/'); privateRanges.addSubnet(net, Number(bits), 'ipv6') }

// "::ffff:1.2.3.4" is an IPv4 address
const plain = address => {
  const text = String(address || '').trim()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text)
  return mapped ? mapped[1] : text
}

export function isCloudflareAddress(address) {
  const ip = plain(address)
  const family = isIP(ip)
  if (!family) return false
  return cloudflare.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

/** Whether an address is a private, loopback or link-local one: the cluster's, never a caller's. */
export function isPrivateAddress(address) {
  const ip = plain(address)
  const family = isIP(ip)
  if (!family) return false
  return privateRanges.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

/** Whether an address stands for many callers or none (a Cloudflare edge, the cluster's own): per-address counts skip it. */
export const isProxyAddress = address => isCloudflareAddress(address) || isPrivateAddress(address)

/**
 * forwardedFor: the X-Forwarded-For header; forwardedCount: HTTP_FORWARDED_COUNT; fallback: the
 * address Meteor worked out (the socket's address when the count is 0).
 */
export function resolveClientAddress({ forwardedFor, forwardedCount, fallback = null }) {
  const count = Number.parseInt(forwardedCount, 10) || 0
  if (count <= 0 || typeof forwardedFor !== 'string') return fallback
  const entries = forwardedFor.split(',').map(plain).filter(Boolean)
  // the entry our own first proxy wrote; anything further left came from outside
  let index = entries.length - count
  if (index < 0 || !isIP(entries[index] || '')) return fallback
  while (index > 0 && isCloudflareAddress(entries[index]) && isIP(entries[index - 1])) index -= 1
  return entries[index]
}

/**
 * The address a per-address count is kept under: an IPv4 address as it is, an IPv6 address by its
 * /64 network (one household or machine is usually given a whole /64, so its addresses are one
 * caller). Null for no address.
 */
export function addressBucket(address) {
  const ip = plain(address)
  const family = isIP(ip)
  if (family === 4) return ip
  if (family !== 6) return ip || null
  const [head, tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  // An embedded IPv4 tail (::1.2.3.4) is two groups; the /64 is in the first four anyway.
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16)).join(':') + '::/64'
}
