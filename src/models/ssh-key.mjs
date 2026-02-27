import mongoose from 'mongoose';

const sshKeySchema = new mongoose.Schema({
  name: { type: String, required: true },
  privateKey: { type: String, required: true },
  publicKey: { type: String, default: '' },
}, { timestamps: true });

const SshKey = mongoose.model('SshKey', sshKeySchema);

export { SshKey };
