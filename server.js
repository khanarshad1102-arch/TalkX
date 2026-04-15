const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.get("/", (_req, res) => {
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

let waitingUsers = [];

function removeFromQueue(socket) {
  waitingUsers = waitingUsers.filter((user) => user.id !== socket.id);
}

function isValidSocket(socket) {
  return socket && socket.connected;
}

function areCompatible(a, b) {
  const aTargetCountry = String(a.data.targetCountry || "").trim();
  const bCountry = String(b.data.country || "").trim();

  const bTargetCountry = String(b.data.targetCountry || "").trim();
  const aCountry = String(a.data.country || "").trim();

  const aInterest = String(a.data.interest || "").trim().toLowerCase();
  const bInterest = String(b.data.interest || "").trim().toLowerCase();

  const countryMatchA = !aTargetCountry || aTargetCountry === bCountry;
  const countryMatchB = !bTargetCountry || bTargetCountry === aCountry;

  const interestMatch = !aInterest || !bInterest || aInterest === bInterest;

  return countryMatchA && countryMatchB && interestMatch;
}

function getPartner(socket) {
  if (!socket.data.partnerId) return null;
  return io.sockets.sockets.get(socket.data.partnerId) || null;
}

function pairUsers(a, b) {
  a.data.partnerId = b.id;
  b.data.partnerId = a.id;

  a.emit("connected", {
    partnerProfile: {
      country: b.data.country || "Unknown",
      interest: b.data.interest || "",
      language: b.data.language || "en"
    }
  });

  b.emit("connected", {
    partnerProfile: {
      country: a.data.country || "Unknown",
      interest: a.data.interest || "",
      language: a.data.language || "en"
    }
  });
}

function enqueueOrMatch(socket) {
  removeFromQueue(socket);

  const partnerIndex = waitingUsers.findIndex((candidate) => {
    return (
      candidate.id !== socket.id &&
      !candidate.data.partnerId &&
      isValidSocket(candidate) &&
      areCompatible(socket, candidate)
    );
  });

  if (partnerIndex !== -1) {
    const partner = waitingUsers.splice(partnerIndex, 1)[0];
    pairUsers(socket, partner);
  } else {
    waitingUsers.push(socket);
    socket.emit("waiting");
  }
}

function disconnectPair(socket, reason = "partner-disconnected") {
  const partner = getPartner(socket);
  socket.data.partnerId = null;

  if (partner && isValidSocket(partner)) {
    partner.data.partnerId = null;
    partner.emit(reason);
    enqueueOrMatch(partner);
  }
}

io.on("connection", (socket) => {
  socket.data = {
    country: "",
    targetCountry: "",
    interest: "",
    language: "en",
    partnerId: null
  };

  socket.on("join-queue", (prefs = {}) => {
    socket.data.country = String(prefs.country || "").trim();
    socket.data.targetCountry = String(prefs.targetCountry || "").trim();
    socket.data.interest = String(prefs.interest || "").trim();
    socket.data.language = String(prefs.language || "en").trim() || "en";
    socket.data.partnerId = null;

    enqueueOrMatch(socket);
  });

  socket.on("message", (payload = {}) => {
    const partner = getPartner(socket);
    if (!partner || !isValidSocket(partner)) return;

    const text = String(payload.text || "").trim();
    const translatedText = String(payload.translatedText || "").trim();
    const fromLanguage = String(payload.fromLanguage || socket.data.language || "en");

    if (!text) return;

    partner.emit("message", {
      text,
      translatedText,
      fromLanguage
    });
  });

  socket.on("typing", () => {
    const partner = getPartner(socket);
    if (partner && isValidSocket(partner)) {
      partner.emit("typing");
    }
  });

  socket.on("next", () => {
    removeFromQueue(socket);
    disconnectPair(socket);
    enqueueOrMatch(socket);
  });

  socket.on("block-user", () => {
    removeFromQueue(socket);
    disconnectPair(socket, "blocked-by-partner");
    enqueueOrMatch(socket);
  });

  socket.on("report-user", (payload = {}) => {
    const partner = getPartner(socket);
    console.log("Report:", {
      reporter: socket.id,
      reported: partner ? partner.id : null,
      reason: payload.reason || "unspecified"
    });
    socket.emit("report-saved");
  });

  socket.on("webrtc-offer", (offer) => {
    const partner = getPartner(socket);
    if (partner && isValidSocket(partner)) {
      partner.emit("webrtc-offer", offer);
    }
  });

  socket.on("webrtc-answer", (answer) => {
    const partner = getPartner(socket);
    if (partner && isValidSocket(partner)) {
      partner.emit("webrtc-answer", answer);
    }
  });

  socket.on("webrtc-ice-candidate", (candidate) => {
    const partner = getPartner(socket);
    if (partner && isValidSocket(partner)) {
      partner.emit("webrtc-ice-candidate", candidate);
    }
  });

  socket.on("voice-ended", () => {
    const partner = getPartner(socket);
    if (partner && isValidSocket(partner)) {
      partner.emit("voice-ended");
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket);
    disconnectPair(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("TalkX backend running on port " + PORT);
});
