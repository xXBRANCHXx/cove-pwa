import PocketBase from 'pocketbase';

export const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090');
pb.autoCancellation(false);
// Optionally, enable auto cancellation
// pb.autoCancellation(false);
