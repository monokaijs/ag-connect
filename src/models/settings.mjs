import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },
  hostMountPath: { type: String, default: '' },
}, { timestamps: true });

const Settings = mongoose.model('Settings', settingsSchema);

async function getSettings() {
  let doc = await Settings.findOne({ key: 'global' });
  if (!doc) {
    doc = await Settings.create({ key: 'global' });
  }
  return doc;
}

export { Settings, getSettings };
