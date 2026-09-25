import { GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";

import { s3 } from "../src/lib/s3";

// Browsers PUT multipart parts straight to S3, so the bucket must allow the app
// origins and expose ETag. Reads go through the Next.js content route, so PUT is enough.
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error("S3_BUCKET is not set.");

const origins = (process.env.S3_CORS_ORIGINS ?? (process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : ""))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (!origins.length) throw new Error("Set S3_CORS_ORIGINS (comma-separated) or AUTH_URL.");

await s3.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedOrigins: origins,
      AllowedMethods: ["PUT"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    }],
  },
}));

const { CORSRules } = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`CORS rules on ${bucket}:`, JSON.stringify(CORSRules, null, 2));
