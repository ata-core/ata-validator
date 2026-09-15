import app from './app-ata-aot'
const server = Bun.serve({ port: 0, fetch: app.fetch })
// Ready means the socket is listening and the module graph is fully evaluated,
// which is what a caller actually waits for. RSS is read at that same instant.
console.log(JSON.stringify({ ready_ms: performance.now(), rss: process.memoryUsage.rss() }))
server.stop(true)
process.exit(0)
