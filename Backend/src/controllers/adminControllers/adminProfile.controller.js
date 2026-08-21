import { Admin } from "../../models/admin.models.js";

import ApiError from "../../utils/apierror.js";
import ApiResponse from "../../utils/apiresponse.js";

const getProfile = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.user._id).select("-password -refreshToken");
    if (!admin) throw new ApiError(404, "Admin not found");

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          adminId: admin._id,
          fullname: admin.fullname,
          email: admin.email,
          phone: admin.phone,
          status: admin.isActive ? "active" : "inactive",
        },
        "Admin profile fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { fullname, phone } = req.body;

    if (fullname !== undefined && (fullname.trim().length < 3 || fullname.trim().length > 50)) {
      throw new ApiError(400, "Full name must be between 3 and 50 characters");
    }
    if (phone !== undefined && !/^03\d{9}$/.test(phone.trim())) {
      throw new ApiError(400, "Phone must be 11 digits starting with 03");
    }

    const updated = await Admin.findByIdAndUpdate(
      req.user._id,
      {
        ...(fullname !== undefined && { fullname: fullname.trim() }),
        ...(phone !== undefined && { phone: phone.trim() }),
      },
      { new: true, runValidators: true },
    ).select("-password -refreshToken");

    return res.status(200).json(new ApiResponse(200, updated, "Admin profile updated"));
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      throw new ApiError(400, "currentPassword and newPassword are required");
    }

    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=])[A-Za-z\d@$!%*?&#^()_\-+=]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      throw new ApiError(
        400,
        "New password must be at least 8 characters and contain uppercase, lowercase, number and special character",
      );
    }

    const admin = await Admin.findById(req.user._id);
    if (!admin) throw new ApiError(404, "Admin not found");

    const isCorrect = await admin.isPasswordCorrect(currentPassword);
    if (!isCorrect) throw new ApiError(401, "Current password is incorrect");

    admin.password = newPassword;
    await admin.save();

    return res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"));
  } catch (error) {
    next(error);
  }
};

export { getProfile, updateProfile, changePassword };