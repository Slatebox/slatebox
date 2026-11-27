// Method and login timing on this server (server/metrics/method-timing.mjs), from Meteor's own
// instrumentation seam (the `instrumentation` package, Meteor 3.6): ddp-server times every method
// from dispatch until its write fence is armed (so a write that waits on its observers shows up),
// `login` included, and every publication until it is ready. Off unless settings.metrics.methodTiming
// is true (Cloud turns it on; a self-hosted install leaves it off). Off, emission is switched off too.
import { Meteor } from 'meteor/meteor'
import { DDP } from 'meteor/ddp-client'
import { Instrumentation } from 'meteor/instrumentation'
import { WINDOW_MS, createMethodTiming, timingSettings } from './method-timing.mjs'

const { on, sampleRate } = timingSettings(Meteor.settings)

if (!on) {
  Instrumentation.configure({ enabled: false })
} else {
  // Nothing but names and durations: arguments, results and client addresses stay uncaptured.
  Instrumentation.configure({ enabled: true, captureMethodArgs: false, captureMethodResult: false, captureClientAddress: false })
  const timing = createMethodTiming({ sampleRate })
  // A method called from inside another method or publication on this server is a nested call: its
  // start is emitted synchronously before its own invocation is entered, so the current invocation
  // there is the caller's. Client calls (and server calls outside any invocation) have none.
  // spanId is the same on start and end for one invocation.
  const nested = new Set()
  Instrumentation.on('method.start', event => {
    if (event.spanId && (DDP._CurrentMethodInvocation.get() || DDP._CurrentPublicationInvocation.get())) nested.add(event.spanId)
  })
  const kindOf = event => (nested.delete(event.spanId) ? 'call' : 'method')
  Instrumentation.on('method.end', event => timing.record(kindOf(event), event.name, event.durationMs))
  Instrumentation.on('method.error', event => timing.record(kindOf(event), event.name, event.durationMs, true))

  // A publication counts once: when it is ready, or when it fails before that.
  const pending = new Set()
  const key = event => `${event.connectionId}\u0000${event.subscriptionId}`
  Instrumentation.on('publication.start', event => { if (event.name && event.subscriptionId) pending.add(key(event)) })
  Instrumentation.on('publication.ready', event => {
    if (pending.delete(key(event))) timing.record('publication', event.name, event.durationMs)
  })
  Instrumentation.on('publication.error', event => {
    if (pending.delete(key(event))) timing.record('publication', event.name, event.durationMs, true)
  })
  Instrumentation.on('publication.stop', event => { pending.delete(key(event)) })

  timing.start()
  console.log(`[method-timing] on: one line per ${WINDOW_MS / 60000} min window${sampleRate < 1 ? `, sampling ${sampleRate}` : ''}`)
}
