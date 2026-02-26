/**
 * Cloudflare Worker: Backblaze B2 Bridge for Cove PWA
 * Handles secure uploads and serves files with zero egress fees (Bandwidth Alliance).
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 1. Handle CORS Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Filename',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        // 2. Handle Upload (POST /upload)
        if (request.method === 'POST' && path === '/upload') {
            return await handleUpload(request, env);
        }

        // 3. Handle File Serving (GET /file/filename)
        if (request.method === 'GET' && path.startsWith('/file/')) {
            return await handleDownload(request, env);
        }

        return new Response('Not Found', { status: 404 });
    }
};

async function getB2Auth(env) {
    const token = btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`);
    const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        headers: { Authorization: `Basic ${token}` }
    });
    if (!res.ok) throw new Error('B2 Auth Failed');
    return await res.json();
}

async function handleUpload(request, env) {
    try {
        const filename = request.headers.get('X-Filename') || `upload-${Date.now()}`;
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const body = await request.arrayBuffer();

        // Get Auth and Upload URL
        const auth = await getB2Auth(env);
        const uploadUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
            method: 'POST',
            headers: { Authorization: auth.authorizationToken },
            body: JSON.stringify({ bucketId: env.B2_BUCKET_ID })
        });

        if (!uploadUrlRes.ok) {
            const err = await uploadUrlRes.text();
            return new Response(`B2 Get Upload URL Failed: ${err}`, { status: 500 });
        }

        const uploadUrlData = await uploadUrlRes.json();

        // Perform Upload
        const hash = await crypto.subtle.digest('SHA-1', body);
        const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

        const b2UploadRes = await fetch(uploadUrlData.uploadUrl, {
            method: 'POST',
            headers: {
                Authorization: uploadUrlData.authorizationToken,
                'X-Bz-File-Name': encodeURIComponent(filename),
                'Content-Type': contentType,
                'X-Bz-Content-Sha1': hashHex,
            },
            body: body
        });

        if (!b2UploadRes.ok) {
            const err = await b2UploadRes.text();
            return new Response(`B2 Upload Failed: ${err}`, { status: 500 });
        }

        const b2Data = await b2UploadRes.json();
        const workerUrl = new URL(request.url).origin;

        return new Response(JSON.stringify({
            url: `${workerUrl}/file/${b2Data.fileName}`,
            fileName: b2Data.fileName
        }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (err) {
        return new Response(err.message, { status: 500 });
    }
}

async function handleDownload(request, env) {
    const fileName = request.url.split('/file/')[1];
    if (!fileName) return new Response('Missing filename', { status: 400 });

    const auth = await getB2Auth(env);
    // Using download URL with auth to proxy B2 content
    // Bandwidth Alliance means CF -> B2 is free
    const downloadUrl = `${auth.downloadUrl}/file/${env.B2_BUCKET_NAME}/${fileName}`;

    const res = await fetch(downloadUrl, {
        headers: { Authorization: auth.authorizationToken }
    });

    const response = new Response(res.body, res);
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
}
