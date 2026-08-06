import { Router } from "express";
import {
  getQueueStatus,
  startClinic,
  nextPatient,
  updateDelay,
  updateTime,
  endClinic,
  resetQueue,
} from "../controllers/queue.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();

// Everything requires a logged-in user.
router.use(verifyJWT);

router.patch("/start", startClinic);
router.patch("/next", nextPatient);
router.patch("/delay", updateDelay);
router.patch("/time", updateTime);
router.patch("/end", endClinic);
router.patch("/reset", resetQueue);
router.get("/:doctorId", getQueueStatus);

export default router;