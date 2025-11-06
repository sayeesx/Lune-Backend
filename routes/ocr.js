import express from 'express';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========================================
// IMAGE OCR ENDPOINT
// ========================================

router.post('/extract', async (req, res) => {
  let worker = null;

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'No image provided',
      });
    }

    console.log('📸 Image OCR request received');

    // Decode base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // Create temporary directory
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempImagePath = path.join(tempDir, `img_${Date.now()}.jpg`);
    await fs.promises.writeFile(tempImagePath, imageBuffer);

    console.log('✅ Image saved, starting OCR...');

    // Create Tesseract worker
    worker = await Tesseract.createWorker({
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const progress = Math.round(m.progress * 100);
          if (progress % 20 === 0) {
            console.log(`OCR Progress: ${progress}%`);
          }
        }
      },
    });

    // Recognize text
    const result = await worker.recognize(tempImagePath);
    const text = result.data.text || '';

    console.log('✅ OCR completed, text length:', text.length);

    // Cleanup
    await fs.promises.unlink(tempImagePath).catch(() => {});
    await worker.terminate();

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

    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.error('Worker termination error:', e.message);
      }
    }

    // Don't crash - return error response
    res.status(500).json({
      success: false,
      error: error.message || 'Image OCR extraction failed',
    });
  }
});

// ========================================
// PDF OCR ENDPOINT - SIMPLIFIED
// ========================================

router.post('/extract-pdf', async (req, res) => {
  let worker = null;

  try {
    const { pdfBase64 } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({
        success: false,
        error: 'No PDF provided',
      });
    }

    console.log('📄 PDF extraction request received');

    // Decode base64 to buffer
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

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
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempPdfPath = path.join(tempDir, `pdf_${Date.now()}.pdf`);
    
    // Save PDF to file
    await fs.promises.writeFile(tempPdfPath, pdfBuffer);
    console.log('✅ PDF saved to temp file');

    // Create Tesseract worker
    worker = await Tesseract.createWorker({
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const progress = Math.round(m.progress * 100);
          if (progress % 20 === 0) {
            console.log(`PDF OCR Progress: ${progress}%`);
          }
        }
      },
    });

    console.log('🔍 Starting OCR on PDF...');
    
    // Process PDF
    const result = await worker.recognize(tempPdfPath);
    const text = result.data.text || '';

    console.log('✅ PDF OCR completed, text length:', text.length);

    // Cleanup
    await fs.promises.unlink(tempPdfPath).catch(() => {});
    await worker.terminate();

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

    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.error('Worker termination error:', e.message);
      }
    }

    // IMPORTANT: Always return a response, never crash
    res.status(500).json({
      success: false,
      error: error.message || 'PDF extraction failed',
    });
  }
});

export default router;
