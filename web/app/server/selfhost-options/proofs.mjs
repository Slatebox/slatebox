// This server's one-time proofs for Slatebox Cloud (licenses/host-proof.mjs): made by the trial
// request (service.mjs) and answered at GET /.well-known/slatebox-license-proof/<id>
// (server/apiHooks.js), so Cloud can tell the trial's host is really this server.
import { createProofStore } from '../licenses/host-proof.mjs'

export const installProofs = createProofStore()
