#!/usr/bin/env python3
import argparse
import sys

import cv2
import numpy as np


THRESHOLD_MAPS = {
    "round": np.array([
        [0, 32, 8, 40, 2, 34, 10, 42],
        [48, 16, 56, 24, 50, 18, 58, 26],
        [12, 44, 4, 36, 14, 46, 6, 38],
        [60, 28, 52, 20, 62, 30, 54, 22],
        [3, 35, 11, 43, 1, 33, 9, 41],
        [51, 19, 59, 27, 49, 17, 57, 25],
        [15, 47, 7, 39, 13, 45, 5, 37],
        [63, 31, 55, 23, 61, 29, 53, 21],
    ], dtype=np.float32),
    "ellipse": np.array([
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
    ], dtype=np.float32),
    "line": np.array([
        [0, 2, 4, 6],
        [8, 10, 12, 14],
        [1, 3, 5, 7],
        [9, 11, 13, 15],
    ], dtype=np.float32),
}


def build_ordered_dither(gray: np.ndarray, dot: str, lpi: int) -> np.ndarray:
    matrix = THRESHOLD_MAPS.get(dot, THRESHOLD_MAPS["round"])
    h, w = gray.shape
    m_h, m_w = matrix.shape
    scale = max(1, int(round(65 / max(1, lpi))))
    y_idx = (np.arange(h) // scale) % m_h
    x_idx = (np.arange(w) // scale) % m_w
    tiled = matrix[np.ix_(y_idx, x_idx)]
    threshold = (tiled + 0.5) * (255.0 / (m_h * m_w))
    return np.where(gray > threshold, 255, 0).astype(np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", choices=["mono", "cmyk"], required=True)
    parser.add_argument("--lpi", type=int, required=True)
    parser.add_argument("--angle", type=float, required=True)
    parser.add_argument("--dpi", type=int, required=True)
    parser.add_argument("--dot", choices=["round", "ellipse", "line"], required=True)
    parser.add_argument("--contrast", type=float, required=True)
    parser.add_argument("--brightness", type=float, required=True)
    parser.add_argument("--transparent", required=True)
    args = parser.parse_args()

    image = cv2.imread(args.input, cv2.IMREAD_UNCHANGED)
    if image is None:
                raise RuntimeError("Unable to read input image")

    if image.ndim == 2:
        bgra = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        bgra = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    else:
        bgra = image.copy()

    bgr = bgra[:, :, :3]
    alpha = bgra[:, :, 3].copy()

    center = (bgr.shape[1] / 2, bgr.shape[0] / 2)
    rot = cv2.getRotationMatrix2D(center, args.angle, 1.0)
    bgr = cv2.warpAffine(bgr, rot, (bgr.shape[1], bgr.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    alpha = cv2.warpAffine(alpha, rot, (alpha.shape[1], alpha.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    beta = args.brightness * 2.55
    alpha_gain = max(0.1, 1.0 + (args.contrast / 100.0))
    bgr = cv2.convertScaleAbs(bgr, alpha=alpha_gain, beta=beta)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    dither = build_ordered_dither(gray, args.dot, args.lpi)

    out = np.zeros((gray.shape[0], gray.shape[1], 4), dtype=np.uint8)
    out[:, :, 0] = dither
    out[:, :, 1] = dither
    out[:, :, 2] = dither

    transparent = str(args.transparent).lower() in ("1", "true", "yes", "y")
    if transparent:
        out[:, :, 3] = np.where(dither == 255, 0, alpha)
    else:
        out[:, :, 3] = alpha

    ok = cv2.imwrite(args.output, out)
    if not ok:
        raise RuntimeError("Unable to write output image")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2)
