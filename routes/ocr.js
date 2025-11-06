import express from 'express';
import Tesseract from 'tesseract.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract text from image using Tesseract.js
 * POST /api/ocr/extract
 */
router.post('/extract', async (req, res) => {
  try {
    const { imageBase64, imageType } = req.body;

    // Validate input
    if (!imageBase64) {
      console.error('❌ Missing imageBase64');
      return res.status(400).json({
        success: false,
        error: 'Image base64 is required'
      });
    }

    if (typeof imageBase64 !== 'string') {
      console.error('❌ imageBase64 is not a string:', typeof imageBase64);
      return res.status(400).json({
        success: false,
        error: 'Image base64 must be a string'
      });
    }

    // Validate base64 format
    if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
      console.error('❌ Invalid base64 format');
      return res.status(400).json({
        success: false,
        error: 'Invalid base64 encoding'
      });
    }

    console.log('🔵 Starting OCR extraction from image...');
    console.log('📊 Base64 size:', Math.round(imageBase64.length / 1024), 'KB');

    // Convert base64 to buffer
    let imageBuffer;
    try {
      imageBuffer = Buffer.from(imageBase64, 'base64');
    } catch (bufferErr) {
      console.error('❌ Failed to create buffer:', bufferErr.message);
      return res.status(400).json({
        success: false,
        error: 'Failed to decode base64: ' + bufferErr.message
      });
    }

    // Validate buffer
    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid image buffer'
      });
    }

    console.log('📊 Buffer size:', Math.round(imageBuffer.length / 1024), 'KB');

    // Run Tesseract with progress logging
    const { data: { text, confidence } } = await Tesseract.recognize(
      imageBuffer,
      'eng+hin',
      {
        logger: (m) => {
          if (m.status === 'recognizing') {
            console.log(`📊 OCR Progress: ${(m.progress * 100).toFixed(1)}%`);
          }
        }
      }
    );

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No text could be extracted from the image. Please ensure the image is clear and contains readable text.'
      });
    }

    console.log('✅ OCR extraction complete');
    console.log('📝 Extracted text length:', text.length);
    console.log('🎯 Confidence:', (confidence * 100).toFixed(1), '%');

    // Clean up text
    const cleanedText = text
      .trim()
      .split('\n')
      .filter(line => line.trim().length > 0)
      .join('\n');

    return res.status(200).json({
      success: true,
      data: {
        text: cleanedText,
        confidence: confidence || 0.85,
        length: cleanedText.length,
        lines: cleanedText.split('\n').length
      }
    });

  } catch (error) {
    console.error('❌ OCR Error:', error.message);
    console.error('Stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: 'OCR extraction failed: ' + error.message
    });
  }
});

/**
 * Extract text from PDF
 * POST /api/ocr/extract-pdf
 */
router.post('/extract-pdf', async (req, res) => {
  try {
    const { pdfBase64 } = req.body;

    if (!pdfBase64) {
      console.error('❌ Missing pdfBase64');
      return res.status(400).json({
        success: false,
        error: 'PDF base64 is required'
      });
    }

    if (typeof pdfBase64 !== 'string') {
      console.error('❌ pdfBase64 is not a string:', typeof pdfBase64);
      return res.status(400).json({
        success: false,
        error: 'PDF base64 must be a string'
      });
    }

    console.log('🔵 Starting PDF extraction...');
    console.log('📊 Base64 size:', Math.round(pdfBase64.length / 1024), 'KB');

    // Convert base64 to buffer
    let pdfBuffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
    } catch (bufferErr) {
      console.error('❌ Failed to create buffer:', bufferErr.message);
      return res.status(400).json({
        success: false,
        error: 'Failed to decode base64: ' + bufferErr.message
      });
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid PDF buffer'
      });
    }

    console.log('📊 Buffer size:', Math.round(pdfBuffer.length / 1024), 'KB');

    let extractedText = '';
    let method = 'text-extraction';

    try {
      console.log('🔍 Attempting text extraction from PDF...');
      const data = await pdfParse(pdfBuffer, {
        max: 10
      });
      extractedText = data.text;
      console.log('📄 PDF text extracted:', extractedText.length, 'characters');
    } catch (pdfErr) {
      console.log('⚠️  PDF text extraction failed:', pdfErr.message);
      method = 'ocr';
    }

    // If insufficient text, use OCR
    if (!extractedText || extractedText.trim().length < 100) {
      console.log('🔵 Running OCR on PDF...');
      method = 'ocr';
      
      try {
        const { data: { text } } = await Tesseract.recognize(
          pdfBuffer,
          'eng+hin',
          {
            logger: (m) => {
              if (m.status === 'recognizing') {
                console.log(`📊 OCR Progress: ${(m.progress * 100).toFixed(1)}%`);
              }
            }
          }
        );
        extractedText = text;
        console.log('📝 OCR extracted:', extractedText.length, 'characters');
      } catch (ocrErr) {
        console.error('OCR failed:', ocrErr.message);
        if (!extractedText) {
          throw ocrErr;
        }
      }
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No text could be extracted from the PDF.'
      });
    }

    console.log('✅ PDF extraction complete');

    // Clean up text
    const cleanedText = extractedText
      .trim()
      .split('\n')
      .filter(line => line.trim().length > 0)
      .join('\n');

    return res.status(200).json({
      success: true,
      data: {
        text: cleanedText,
        confidence: 0.85,
        length: cleanedText.length,
        lines: cleanedText.split('\n').length,
        method: method
      }
    });

  } catch (error) {
    console.error('❌ PDF Error:', error.message);
    console.error('Stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: 'PDF extraction failed: ' + error.message
    });
  }
});

/**
 * Health check
 * GET /api/ocr/health
 */
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'OCR service is running',
    engines: ['Tesseract.js', 'pdf-parse'],
    languages: ['English', 'Hindi'],
    timestamp: new Date().toISOString()
  });
});

export default router;
