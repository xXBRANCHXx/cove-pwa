/**
 * Cloudflare Worker: Backblaze B2 Bridge for Cove PWA
 * Handles secure uploads and serves files with zero egress fees (Bandwidth Alliance).
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const corsHeaders = getCorsHeaders(request, env);

        // 1. Handle CORS Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders,
            });
        }

        // 2. Handle Upload (POST /upload)
        if (request.method === 'POST' && path === '/upload') {
            if (!isAuthorizedUpload(request, env)) {
                return withCors(new Response('Unauthorized', { status: 401 }), corsHeaders);
            }
            return await handleUpload(request, env, corsHeaders);
        }

        // 3. Handle File Serving (GET /file/filename)
        if (request.method === 'GET' && path.startsWith('/file/')) {
            return await handleDownload(request, env, corsHeaders);
        }

        return withCors(new Response('Not Found', { status: 404 }), corsHeaders);
    }
};

function getCorsHeaders(request, env) {
    const requestOrigin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    let allowOrigin = '*';

    if (allowedOrigin !== '*') {
        allowOrigin = requestOrigin === allowedOrigin ? requestOrigin : 'null';
    }

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Filename, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
}

function withCors(response, corsHeaders) {
    const merged = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => merged.set(key, value));
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
    });
}

function isAuthorizedUpload(request, env) {
    if (!env.STORAGE_UPLOAD_TOKEN) return false;
    const auth = request.headers.get('Authorization') || '';
    return auth === `Bearer ${env.STORAGE_UPLOAD_TOKEN}`;
}

async function getB2Auth(env) {
    const token = btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`);
    const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        headers: { Authorization: `Basic ${token}` }
    });
    if (!res.ok) throw new Error('B2 Auth Failed');
    return await res.json();
}

async function handleUpload(request, env, corsHeaders) {
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
            return withCors(new Response(`B2 Get Upload URL Failed: ${err}`, { status: 500 }), corsHeaders);
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
            return withCors(new Response(`B2 Upload Failed: ${err}`, { status: 500 }), corsHeaders);
        }

        const b2Data = await b2UploadRes.json();
        const workerUrl = new URL(request.url).origin;

        return withCors(new Response(JSON.stringify({
            url: `${workerUrl}/file/${b2Data.fileName}`,
            fileName: b2Data.fileName
        }), {
            headers: { 'Content-Type': 'application/json' }
        }), corsHeaders);

    } catch (err) {
        return withCors(new Response(err.message, { status: 500 }), corsHeaders);
    }
}

async function handleDownload(request, env, corsHeaders) {
    const fileName = request.url.split('/file/')[1];
    if (!fileName) return withCors(new Response('Missing filename', { status: 400 }), corsHeaders);

    const auth = await getB2Auth(env);
    // Using download URL with auth to proxy B2 content
    // Bandwidth Alliance means CF -> B2 is free
    const downloadUrl = `${auth.downloadUrl}/file/${env.B2_BUCKET_NAME}/${fileName}`;

    const res = await fetch(downloadUrl, {
        headers: { Authorization: auth.authorizationToken }
    });

    return withCors(new Response(res.body, res), corsHeaders);
}
