import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true });

userSchema.methods.verifyPassword = function (password) {
  return bcrypt.compareSync(password, this.passwordHash);
};

userSchema.statics.hashPassword = function (password) {
  return bcrypt.hashSync(password, 10);
};

const User = mongoose.model('User', userSchema);

export { User };
