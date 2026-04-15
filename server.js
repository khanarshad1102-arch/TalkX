const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.get("/", (_req, res) => {
  res.send("TalkX Pro backend is running");
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 60000,
});

let waitingUsers = [];
const reports = new Map();

function getProfile(socket) {
  return {
    country: socket.data.country || "",
    targetCountry: socket.data.targetCountry || "",
    interest: socket.data.interest || "",
    language: socket.data.language || "en",
  };
}

function isMatch(a, b) {
  const aCountryOk = !a.data.targetCountry || a.data.targetCountry === b.data.country;
  const bCountryOk = !b.data.targetCountry || b.data.targetCountry === a.data.country;

  const aInterest = (a.data.interest || "").trim().toLowerCase();
  const bInterest = (b.data.interest || "").trim().toLowerCase();

  const aInterestOk = !aInterest || !bInterest || aInterest === bInterest;
  const bInterestOk = !bInterest || !aInterest || bInterest === aInterest;

  return aCountryOk && bCountryOk && aInterestOk && bInterestOk;
}

function removeWaiting(socket) {
  waitingUsers = waitingUsers.filter((s) => s !== socket);
}

function enqueueOrPair(socket) {
  removeWaiting(socket);

  const partnerIndex = waitingUsers.findIndex(
    (candidate) => candidate.connected && !candidate.data.partnerId && isMatch(socket, candidate)
  );

  if (partnerIndex >= 0) {
    const partner = waitingUsers.splice(partnerIndex, 1)[0];
    socket.data.partnerId = partner.id;
    partner.data.partnerId = socket.id;

    socket.emit("connected", { partnerProfile: getProfile(partner) });
    partner.emit("connected", { partnerProfile: getProfile(socket) });
    return;
  }

  waitingUsers.push(socket);
  socket.emit("waiting");
}

function getPartner(socket) {
  return socket.data.partnerId ? io.sockets.sockets.get(socket.data.partnerId) : null;
}

function disconnectPair(socket, reason = "partner-disconnected") {
  const partner = getPartner(socket);
  socket.data.partnerId = null;

  if (partner && partner.connected) {
    partner.data.partnerId = null;
    partner.emit(reason);
    enqueueOrPair(partner);
  }
}

io.on("connection", (socket) => {
  socket.data = {
    country: "",
    targetCountry: "",
    interest: "",
    language: "en",
    partnerId: null,
  };

  socket.on("join-queue", (prefs = {}) => {
    socket.data.country = String(prefs.country || "").trim();
    socket.data.targetCountry = String(prefs.targetCountry || "").trim();
    socket.data.interest = String(prefs.interest || "").trim();
    socket.data.language = String(prefs.language || "en").trim() || "en";
    socket.data.partnerId = null;
    enqueueOrPair(socket);
  });

  socket.on("message", (payload = {}) => {
    const partner = getPartner(socket);
    if (!partner || !partner.connected) return;

    const text = String(payload.text || "").trim();
    const translatedText = String(payload.translatedText || "").trim();
    const fromLanguage = String(payload.fromLanguage || socket.data.language || "en");
    if (!text) return;

    partner.emit("message", {
      text,
      translatedText,
      fromLanguage,
    });
  });

  socket.on("typing", () => {
    const partner = getPartner(socket);
    if (partner && partner.connected) partner.emit("typing");
  });

  socket.on("next", () => {
    removeWaiting(socket);
    disconnectPair(socket);
    enqueueOrPair(socket);
  });

  socket.on("block-user", () => {
    removeWaiting(socket);
    disconnectPair(socket, "blocked-by-partner");
    enqueueOrPair(socket);
  });

  socket.on("report-user", (payload = {}) => {
    const partner = getPartner(socket);
    if (!partner) return;
    const key = partner.id;
    const count = reports.get(key) || 0;
    reports.set(key, count + 1);
    console.log("Report received:", {
      reportedSocket: key,
      reason: payload.reason || "unspecified",
      count: count + 1,
    });
    socket.emit("report-saved");
  });

  // WebRTC signaling
  socket.on("webrtc-offer", (offer) => {
    const partner = getPartner(socket);
    if (partner && partner.connected) partner.emit("webrtc-offer", offer);
  });

  socket.on("webrtc-answer", (answer) => {
    const partner = getPartner(socket);
    if (partner && partner.connected) partner.emit("webrtc-answer", answer);
  });

  socket.on("webrtc-ice-candidate", (candidate) => {
    const partner = getPartner(socket);
    if (partner && partner.connected) partner.emit("webrtc-ice-candidate", candidate);
  });

  socket.on("voice-ended", () => {
    const partner = getPartner(socket);
    if (partner && partner.connected) partner.emit("voice-ended");
  });

  socket.on("disconnect", () => {
    removeWaiting(socket);
    disconnectPair(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("TalkX Pro backend running on port " + PORT);
});
