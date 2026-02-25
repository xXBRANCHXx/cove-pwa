// Server-side Cloudinary signing endpoint
// Usage: POST /api/cloudinary-sign
// Returns { timestamp, signature, api_key }
// SECURITY: requires CLOUDINARY_API_SECRET to be set in environment. Do NOT commit secrets.
import crypto from 'crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'cove_unsigned';

  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary API key/secret not configured on server' });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  // Build the signature string. Include upload_preset if present (common for unsigned presets too).
  const paramsToSign = `timestamp=${timestamp}&upload_preset=${uploadPreset}`;
  const signature = crypto.createHash('sha1').update(paramsToSign + apiSecret).digest('hex');

  return res.status(200).json({ timestamp, signature, api_key: apiKey, upload_preset: uploadPreset });
}
