import { SshKey } from './models/ssh-key.mjs';

function setupSettingsRoutes(app) {
  app.get('/api/settings/ssh-keys', async (req, res) => {
    try {
      const keys = await SshKey.find().sort({ createdAt: -1 });
      res.json(keys.map(k => ({
        _id: k._id,
        name: k.name,
        publicKey: k.publicKey,
        hasPrivateKey: !!k.privateKey,
        createdAt: k.createdAt,
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/ssh-keys', async (req, res) => {
    try {
      const { name, privateKey, publicKey } = req.body;
      if (!name || !privateKey) return res.status(400).json({ error: 'Name and private key required' });
      const key = new SshKey({ name, privateKey, publicKey: publicKey || '' });
      await key.save();
      res.json({ _id: key._id, name: key.name, publicKey: key.publicKey, createdAt: key.createdAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/settings/ssh-keys/:id', async (req, res) => {
    try {
      await SshKey.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export { setupSettingsRoutes };
