const WebSocket = require('ws')

const TOKEN = process.argv[2]
const ws = new WebSocket(`ws://localhost:8090/api/realtime?token=${TOKEN}`)

ws.onopen = () => {
  console.log('Connected. Subscribing...')
  ws.send(JSON.stringify({
    type: 'subscribe',
    channels: ['collections.msho2p183d460397.records']
  }))
}

ws.onmessage = (e) => {
  console.log('EVENT RECEIVED:', e.data)
}

ws.onerror = (err) => {
  console.log('WS ERROR:', err.message)
}