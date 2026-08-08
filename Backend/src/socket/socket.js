import { Server } from "socket.io";

let io;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // A patient (or doctor) joins a specific doctor's queue room.
    // doctorId is the Doctor _id they booked / manage.
    socket.on("joinQueue", (doctorId) => {
      if (!doctorId) return;
      socket.join(`queue_${doctorId}`);
      console.log(`Socket ${socket.id} joined queue_${doctorId}`);
    });

    // Leave when the patient closes the queue screen.
    socket.on("leaveQueue", (doctorId) => {
      if (!doctorId) return;
      socket.leave(`queue_${doctorId}`);
      console.log(`Socket ${socket.id} left queue_${doctorId}`);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initSocket(server) first.");
  }
  return io;
};