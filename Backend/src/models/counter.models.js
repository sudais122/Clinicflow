import mongoose from "mongoose";

/**
 * One document per entity, holding the last-used sequence number.
 *   { name: "doctor",      seq: 124 }
 *   { name: "patient",     seq: 845 }
 *   { name: "appointment", seq: 3267 }
 */
const counterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

export const Counter = mongoose.model("Counter", counterSchema);