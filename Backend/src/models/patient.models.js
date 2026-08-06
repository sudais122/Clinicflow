import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
  {
    patientId:{ 
      type: String, 
      unique: true, 
      trim: true 
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
      required: true,
    },

    bloodGroup: {
      type: String,
      enum: [
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-",
      ],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const Patient = mongoose.model("Patient", patientSchema);