import multer from "multer";

// Memory storage — we hand the buffer straight to Cloudinary
// (uploadBufferToCloudinary) rather than writing it to disk first.
const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, or WEBP images are allowed"));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// Wraps upload.single("screenshot") so Multer/file-filter errors come
// back as normal JSON instead of an unhandled exception. The doctor's
// form must submit as multipart/form-data with the file under the
// field name "screenshot".
const uploadScreenshot = (req, res, next) => {
  upload.single("screenshot")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

export { uploadScreenshot };