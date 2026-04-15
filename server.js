const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.get("/", (req, res) => {
  res.send("TalkX backend is running");
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 25000,
  pingTimeout: 60000
});

let waitingUser = null;

function clearPartner(socket) {
  if (socket.partner) {
    const partner = socket.partner;
    socket.partner = null;

    if (partner.connected) {
      partner.partner = null;
      partner.emit("partner-disconnected");
      if (!waitingUser) {
        waitingUser = partner;
        partner.emit("waiting");
      }
    }
  }
}

function pairUsers(a, b) {
  a.partner = b;
  b.partner = a;
  a.emit("connected");
  b.emit("connected");
}

function putInQueue(socket) {
  socket.partner = null;

  if (waitingUser && waitingUser !== socket && waitingUser.connected && !waitingUser.partner) {
    const other = waitingUser;
    waitingUser = null;
    pairUsers(socket, other);
  } else {
    waitingUser = socket;
    socket.emit("waiting");
  }
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  putInQueue(socket);

  socket.on("message", (msg) => {
    const text = typeof msg === "string" ? msg.trim() : "";
    if (!text) return;

    if (socket.partner && socket.partner.connected) {
      socket.partner.emit("message", text);
    }
  });

  socket.on("next", () => {
    if (waitingUser === socket) waitingUser = null;
    clearPartner(socket);
    putInQueue(socket);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (waitingUser === socket) waitingUser = null;
    clearPartner(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("TalkX backend running on port " + PORT);
});
