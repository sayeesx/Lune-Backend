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

    // Create temporary file
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
          console.log(`📊 OCR Progress: ${progress}%`);
        }
      },
    });

    // Recognize text with timeout
    const recognizePromise = worker.recognize(tempImagePath);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('OCR timeout after 60s')), 60000)
    );

    const result = await Promise.race([recognizePromise, timeoutPromise]);
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
        confidence: result.data.confidence || 0.85,
      },
    });
  } catch (error) {
    console.error('❌ Image OCR Error:', error);

    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.error('Worker termination error:', e);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Image OCR extraction failed',
    });
  }
});

// ========================================
// PDF OCR ENDPOINT - Simple Text Extraction
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

    // Save PDF temporarily
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempPdfPath = path.join(tempDir, `pdf_${Date.now()}.pdf`);
    await fs.promises.writeFile(tempPdfPath, pdfBuffer);

    console.log('📖 PDF saved, attempting OCR on all pages...');

    // Create Tesseract worker for PDF OCR
    worker = await Tesseract.createWorker({
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`OCR: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    // Recognize the entire PDF (Tesseract can handle multi-page)
    console.log('🔍 Running OCR on PDF...');
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

    console.log('✅ PDF extraction successful');

    res.json({
      success: true,
      data: {
        text: text.trim(),
        confidence: result.data.confidence || 0.85,
      },
    });
  } catch (error) {
    console.error('❌ PDF Error:', error);

    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.error('Worker termination error:', e);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'PDF extraction failed',
    });
  }
});

export default router;
