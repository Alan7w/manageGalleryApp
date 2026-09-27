// Worker-thread entry: clusters off the main thread so the UI (and thumbnail
// serving) never stalls while a large library is being grouped.
import { parentPort } from 'node:worker_threads'
import { cluster, type ClusterInput } from './cluster'

parentPort!.on('message', (input: ClusterInput) => {
  parentPort!.postMessage(cluster(input))
})
