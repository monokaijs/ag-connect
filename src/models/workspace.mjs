import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  status: {
    type: String,
    enum: ['creating', 'initializing', 'needsLogin', 'running', 'stopped', 'error'],
    default: 'creating',
  },
  stage: { type: String, default: '' },
  containerId: { type: String, default: '' },
  containerName: { type: String, default: '' },
  ports: {
    api: { type: Number, default: 0 },
    debug: { type: Number, default: 0 },
  },
  auth: {
    email: { type: String, default: '' },
    accessToken: { type: String, default: '' },
    refreshToken: { type: String, default: '' },
    expiryTimestamp: { type: Number, default: 0 },
    avatar: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  mountedPath: { type: String, default: '' },
  cdpHost: { type: String, default: '' },
  cdpPort: { type: Number, default: 0 },
  gpi: {
    csrfToken: { type: String, default: '' },
    lsPort: { type: Number, default: 0 },
    lsHost: { type: String, default: '' },
    activeCascadeId: { type: String, default: '' },
  },
  icon: { type: Number, default: -1 },
  color: { type: Number, default: 0 },
  initLogs: [String],
  error: { type: String, default: '' },
  lastActivity: { type: Date, default: Date.now },
}, { timestamps: true });

const Workspace = mongoose.model('Workspace', workspaceSchema);

export { Workspace };
