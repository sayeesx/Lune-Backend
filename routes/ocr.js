import express from 'express';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global worker pool
let imageWorker = null;
let pdfWorker = null;

// Initialize workers
const initImageWorker = async () => {
  if (!imageWorker) {
    console.log('🔧 Initializing image worker...');
    imageWorker = await Tesseract.createWorker();
    console.log('✅ Image worker initialized');
  }
  return imageWorker;
};

const initPdfWorker = async () => {
  if (!pdfWorker) {
    console.log('🔧 Initializing PDF worker...');
    pdfWorker = await Tesseract.createWorker();
    console.log('✅ PDF worker initialized');
  }
  return pdfWorker;
};

// ========================================
// IMAGE OCR ENDPOINT
// ========================================

router.post('/extract', async (req, res) => {
  let tempImagePath = null;

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'No image provided',
      });
    }

    console.log('📸 Image OCR request received');

    // Validate base64
    if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid base64 format',
      });
    }

    // Decode base64
    let imageBuffer;
    try {
      imageBuffer = Buffer.from(imageBase64, 'base64');
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Failed to decode base64',
      });
    }

    if (imageBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Empty image buffer',
      });
    }

    // Create temp directory
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    tempImagePath = path.join(tempDir, `img_${Date.now()}.jpg`);
    await fs.promises.writeFile(tempImagePath, imageBuffer);
    console.log('✅ Image saved');

    // Get or initialize worker
    const worker = await initImageWorker();

    // Recognize text
    console.log('🔍 Starting OCR...');
    const result = await worker.recognize(tempImagePath);
    const text = result.data.text || '';

    console.log('✅ OCR done, text length:', text.length);

    if (!text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'No text detected in image',
      });
    }

    res.json({
      success: true,
      data: {
        text: text.trim(),
        confidence: 0.85,
      },
    });
  } catch (error) {
    console.error('❌ Image OCR Error:', error.message);

    res.status(500).json({
      success: false,
      error: error.message || 'Image OCR failed',
    });
  } finally {
    // Cleanup temp file
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      try {
        await fs.promises.unlink(tempImagePath);
      } catch (e) {
        console.warn('Failed to delete temp file');
      }
    }
  }
});

// ========================================
// PDF OCR ENDPOINT
// ========================================

router.post('/extract-pdf', async (req, res) => {
  let tempPdfPath = null;

  try {
    const { pdfBase64 } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({
        success: false,
        error: 'No PDF provided',
      });
    }

    console.log('📄 PDF extraction request received');

    // Validate base64
    if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid base64 format',
      });
    }

    // Decode base64
    let pdfBuffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Failed to decode base64',
      });
    }

    // Check file size
    const fileSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📊 PDF size: ${fileSizeMB}MB`);

    if (pdfBuffer.length > 50 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'PDF file too large (max 50MB)',
      });
    }

    // Create temp directory
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    tempPdfPath = path.join(tempDir, `pdf_${Date.now()}.pdf`);
    await fs.promises.writeFile(tempPdfPath, pdfBuffer);
    console.log('✅ PDF saved');

    // Get or initialize worker
    const worker = await initPdfWorker();

    // Process PDF
    console.log('🔍 Starting PDF OCR...');
    const result = await worker.recognize(tempPdfPath);
    const text = result.data.text || '';

    console.log('✅ PDF OCR done, text length:', text.length);

    if (!text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'No text extracted from PDF',
      });
    }

    res.json({
      success: true,
      data: {
        text: text.trim(),
        confidence: 0.85,
      },
    });
  } catch (error) {
    console.error('❌ PDF OCR Error:', error.message);

    res.status(500).json({
      success: false,
      error: error.message || 'PDF extraction failed',
    });
  } finally {
    // Cleanup temp file
    if (tempPdfPath && fs.existsSync(tempPdfPath)) {
      try {
        await fs.promises.unlink(tempPdfPath);
      } catch (e) {
        console.warn('Failed to delete temp file');
      }
    }
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'OCR routes healthy',
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down OCR workers...');
  if (imageWorker) await imageWorker.terminate();
  if (pdfWorker) await pdfWorker.terminate();
  process.exit(0);
});

export default router;
