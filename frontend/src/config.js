// The backend's WebSocket origin. Defaults to same-origin, which is all
// local development needs (one `node app.js` answers both the page and the
// socket). Once the frontend is deployed separately from the backend — this
// on Netlify, the backend on Render — set `window.RAHEE_SERVER_URL` in
// index.html to the backend's own wss:// URL before deploying.
export const SERVER_URL = globalThis.RAHEE_SERVER_URL
  || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
