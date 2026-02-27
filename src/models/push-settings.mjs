import mongoose from 'mongoose';

const pushSettingsSchema = new mongoose.Schema({
  firebaseServiceAccount: { type: String, default: '' },
  pushTokens: [{ type: String }],
  updatedAt: { type: Date, default: Date.now },
});

pushSettingsSchema.pre('save', function () {
  this.updatedAt = new Date();
});

export const PushSettings = mongoose.model('PushSettings', pushSettingsSchema);
