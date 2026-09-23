# Scanner detection fixtures

This directory is reserved for public, anonymized scanner fixtures. Do not add
private invoices, receipts, names, addresses, QR codes, or other user data.

Each image should have a matching JSON file with the same basename:

```json
{
  "image": "sample-01.jpg",
  "expectedQuad": {
    "topLeft": { "x": 100, "y": 80 },
    "topRight": { "x": 900, "y": 120 },
    "bottomRight": { "x": 880, "y": 1300 },
    "bottomLeft": { "x": 120, "y": 1280 }
  }
}
```

The first benchmark set should cover these public or synthetic cases:

- white paper on dark table
- white paper on light table
- receipt
- invoice
- shadow across document
- slight fold
- strong perspective
- document near frame edge
- rotated document
- low contrast
- busy background
- two sheets visible
- partial document

The benchmark reports V1 and V2 separately using mean and maximum corner error,
normalized corner error, quad IoU, success rate, fallback rate, and processing
time. A fixture is only useful when its expected quad is measured in the exact
pixel coordinates of the image.

`npm run scanner:benchmark` runs the deterministic V1 baseline utility. Use
`npm run scanner:benchmark:browser` when the local environment can serve the
OpenCV.js runtime; that command opens `/scanner/benchmark` and measures the
actual V1 and V2 pipelines in Chromium.
