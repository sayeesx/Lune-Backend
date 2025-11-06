import express from 'express';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========================================
// IMAGE OCR ENDPOINT - FIXED
// ========================================

router.post('/extract', async (req, res) => {
  let worker = null;
  let tempImagePath = null;

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      console.error('❌ No image provided');
      return res.status(400).json({
        success: false,
        error: 'No image provided',
      });
    }

    console.log('📸 Image OCR request received');

    // Validate base64
    if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
      console.error('❌ Invalid base64 format');
      return res.status(400).json({
        success: false,
        error: 'Invalid base64 format',
      });
    }

    // Decode base64 to buffer
    let imageBuffer;
    try {
      imageBuffer = Buffer.from(imageBase64, 'base64');
      console.log('✅ Base64 decoded');
    } catch (e) {
      console.error('❌ Failed to decode base64:', e.message);
      return res.status(400).json({
        success: false,
        error: 'Failed to decode base64',
      });
    }

    if (imageBuffer.length === 0) {
      console.error('❌ Empty buffer');
      return res.status(400).json({
        success: false,
        error: 'Empty image buffer',
      });
    }

    // Create temporary directory
    const tempDir = path.join(__dirname, '../../temp');
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    } catch (e) {
      console.error('❌ Failed to create temp dir:', e.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to create temp directory',
      });
    }

    tempImagePath = path.join(tempDir, `img_${Date.now()}.jpg`);
    
    try {
      await fs.promises.writeFile(tempImagePath, imageBuffer);
      console.log('✅ Image saved');
    } catch (e) {
      console.error('❌ Failed to write image file:', e.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to save image file',
      });
    }

    // Create Tesseract worker - NO LOGGER FUNCTION
    console.log('🔧 Creating Tesseract worker...');
    try {
      worker = await Tesseract.createWorker();
      console.log('✅ Worker created');
    } catch (e) {
      console.error('❌ Failed to create worker:', e.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to create OCR worker',
      });
    }

    // Recognize text
    console.log('🔍 Starting text recognition...');
    let result;
    try {
      result = await worker.recognize(tempImagePath);
      console.log('✅ Recognition completed');
    } catch (e) {
      console.error('❌ Recognition failed:', e.message);
      return res.status(500).json({
        success: false,
        error: 'Recognition failed',
      });
    }

    const text = result.data.text || '';
    console.log('✅ Text extracted, length:', text.length);

    // Cleanup
    try {
      if (tempImagePath && fs.existsSync(tempImagePath)) {
        await fs.promises.unlink(tempImagePath);
        console.log('✅ Temp file deleted');
      }
    } catch (e) {
      console.warn('⚠️  Failed to delete temp file');
    }

    try {
      await worker.terminate();
      console.log('✅ Worker terminated');
    } catch (e) {
      console.warn('⚠️  Failed to terminate worker');
    }

    if (!text.trim()) {
      console.error('❌ No text detected');
      return res.status(400).json({
        success: false,
        error: 'No text detected in image',
      });
    }

    console.log('✅ Sending success response');
    res.json({
      success: true,
      data: {
        text: text.trim(),
        confidence: 0.85,
      },
    });
  } catch (error) {
    console.error('❌ IMAGE OCR ERROR:', error.message);

    // Cleanup on error
    try {
      if (tempImagePath && fs.existsSync(tempImagePath)) {
        await fs.promises.unlink(tempImagePath);
      }
    } catch (e) {
      console.warn('Cleanup failed');
    }

    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.warn('Worker termination error');
      }
    }

    res.status(500).json({
      success: false,
      error: 'Image OCR extraction failed',
    });
  }
});

// ========================================
// PDF OCR ENDPOINT - FIXED
// ========================================

router.post('/extract-pdf', async (req, res) => {
  let worker = null;
  let tempPdfPath = null;

  try {
    const { pdfBase64 } = req.body;

    if (!pdfBase64) {
      console.error('❌ No PDF provided');
      return res.status(400).json({
        success: false,
        error: 'No PDF provided',
      });
    }

    console.log('📄 PDF extraction request received');

    // Validate base64
    if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
      console.error('❌ Invalid base64 format');
      return res.status(400).json({
        success: false,
        error: 'Invalid base64 format',
      });
    }

    // Decode base64 to buffer
    let pdfBuffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
      console.log('✅ Base64 decoded');
    } catch (e) {
      console.error('❌ Failed to decode base64:', e.message);
      return res.status(400).json({
        success: false,
        error: 'Failed to decode base64',
      });
    }

    // Check file size
    const fileSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📊 PDF size: ${fileSizeMB}MB`);

    if (pdfBuffer.length > 50 * 1024 * 1024) {
      console.error('❌ PDF too large');
      return res.status(400).json({
        success: false,
        error: 'PDF file too large (max 50MB)',
      });
    }

    // Create temp directory
    const tempDir = path.join(__dirname, '../../temp');
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    } catch (e) {
      console.error('❌ Failed to create temp dir:', e.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to create temp directory',
      });
    }

    tempPdfPath = path.join(tempDir, `pdf_${Date.now()}.pdf`);
    
    // Save PDF to file
    try {
      await fs.promises.writeFile(tempPdfPath, pdfBuffer);
      console.log('✅ PDF saved');
    } catch (e) {
      console.error('❌ Failed to write PDF file:', e.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to save PDF file',
      });
    }

    // Create Tesseract worker - NO LOGGER FUNCTION
    console.log('🔧 Creating Tesseract worker for PDF...');
    try {
      worker = await Tesseract.createWorker();
      console.log('✅ Worker created');
    } catch (e) {
      console.error('❌ Failed to create worker:', e.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to create OCR worker',
      });
    }

    // Process PDF
    console.log('🔍 Starting PDF OCR...');
    let result;
    try {
      result = await worker.recognize(tempPdfPath);
      console.log('✅ PDF recognition completed');
    } catch (e) {
      console.error('❌ PDF recognition failed:', e.message);
      return res.status(500).json({
        success: false,
        error: 'PDF recognition failed',
      });
    }

    const text = result.data.text || '';
    console.log('✅ Text extracted from PDF, length:', text.length);

    // Cleanup
    try {
      if (tempPdfPath && fs.existsSync(tempPdfPath)) {
        await fs.promises.unlink(tempPdfPath);
        console.log('✅ Temp PDF deleted');
      }
    } catch (e) {
      console.warn('⚠️  Failed to delete temp file');
    }

    try {
      await worker.terminate();
      console.log('✅ Worker terminated');
    } catch (e) {
      console.warn('⚠️  Failed to terminate worker');
    }

    if (!text.trim()) {
      console.error('❌ No text extracted from PDF');
      return res.status(400).json({
        success: false,
        error: 'No text extracted from PDF',
      });
    }

    console.log('✅ Sending success response');
    res.json({
      success: true,
      data: {
        text: text.trim(),
        confidence: 0.85,
      },
    });
  } catch (error) {
    console.error('❌ PDF OCR ERROR:', error.message);

    // Cleanup on error
    try {
      if (tempPdfPath && fs.existsSync(tempPdfPath)) {
        await fs.promises.unlink(tempPdfPath);
      }
    } catch (e) {
      console.warn('Cleanup failed');
    }

    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.warn('Worker termination error');
      }
    }

    res.status(500).json({
      success: false,
      error: 'PDF extraction failed',
    });
  }
});

// Health check for OCR
router.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'OCR routes healthy',
  });
});

export default router;
