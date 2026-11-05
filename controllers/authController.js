const UserDTO = require("../dtos/user.dto");
const { sendSuccess } = require("../utils/response");

const logout = (req, res) => {
  sendSuccess(res, null, "Signed out");
};

const getMe = (req, res) => {
  sendSuccess(res, UserDTO.toResponse(req.user), "Profile loaded");
};

module.exports = { logout, getMe };
