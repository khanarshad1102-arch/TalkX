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
  }
});

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  if (waitingUser && waitingUser.connected) {
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    socket.emit("connected");
    waitingUser.emit("connected");

    waitingUser = null;
  } else {
    waitingUser = socket;
    socket.emit("waiting");
  }

  socket.on("message", (msg) => {
    if (socket.partner && socket.partner.connected) {
      socket.partner.emit("message", msg);
    }
  });

  socket.on("next", () => {
    if (socket.partner && socket.partner.connected) {
      socket.partner.emit("partner-disconnected");
      socket.partner.partner = null;
      socket.partner.emit("waiting");
    }

    socket.partner = null;

    if (waitingUser && waitingUser !== socket && waitingUser.connected) {
      socket.partner = waitingUser;
      waitingUser.partner = socket;

      socket.emit("connected");
      waitingUser.emit("connected");

      waitingUser = null;
    } else {
      waitingUser = socket;
      socket.emit("waiting");
    }
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket) {
      waitingUser = null;
    }

    if (socket.partner && socket.partner.connected) {
      socket.partner.emit("partner-disconnected");
      socket.partner.partner = null;

      if (!waitingUser) {
        waitingUser = socket.partner;
        socket.partner.emit("waiting");
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("TalkX backend running on port " + PORT);
});
