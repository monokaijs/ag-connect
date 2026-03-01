import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  avatar: { type: String, default: '' },
  accessToken: { type: String, default: '' },
  refreshToken: { type: String, default: '' },
  expiryTimestamp: { type: Number, default: 0 },
}, { timestamps: true });

const Account = mongoose.model('Account', accountSchema);

export { Account };
