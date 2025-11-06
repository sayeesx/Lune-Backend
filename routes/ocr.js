import express from 'express';
import Tesseract from 'tesseract.js';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract text from image using Tesseract.js
 * POST /api/ocr/extract
 * Body: { imageBase64: string, imageType: string }
 */
router.post('/extract', async (req, res) => {
  try {
    const { imageBase64, imageType } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'Image base64 is required'
      });
    }

    console.log('🔵 Starting OCR extraction from image...');
    console.log('📊 Image size:', Math.round(imageBase64.length / 1024), 'KB');

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');

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
    return res.status(500).json({
      success: false,
      error: 'OCR extraction failed: ' + error.message
    });
  }
});

/**
 * Extract text from PDF using Tesseract.js + pdf-parse
 * POST /api/ocr/extract-pdf
 * Body: { pdfBase64: string }
 */
router.post('/extract-pdf', async (req, res) => {
  try {
    const { pdfBase64 } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({
        success: false,
        error: 'PDF base64 is required'
      });
    }

    console.log('🔵 Starting PDF extraction...');
    console.log('📊 PDF size:', Math.round(pdfBase64.length / 1024), 'KB');

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    let extractedText = '';
    let method = 'text-extraction';

    try {
      // First, try to extract text from searchable PDFs
      console.log('🔍 Attempting text extraction from PDF...');
      const data = await pdfParse(pdfBuffer, {
        max: 10 // Limit to first 10 pages
      });
      extractedText = data.text;
      console.log('📄 PDF text extracted:', extractedText.length, 'characters');
    } catch (pdfErr) {
      console.log('⚠️  PDF text extraction failed, will use OCR');
      method = 'ocr';
    }

    // If PDF has insufficient text, use OCR on the image
    if (!extractedText || extractedText.trim().length < 100) {
      console.log('🔵 Running OCR on PDF pages...');
      
      // For scanned PDFs, we need to convert to image first
      // This is a simplified approach - for production, use pdf2pic or similar
      try {
        const { data: { text, confidence } } = await Tesseract.recognize(
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
        console.log('📝 OCR extracted from PDF:', extractedText.length, 'characters');
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
        error: 'No text could be extracted from the PDF. Please ensure it contains readable text or is not encrypted.'
      });
    }

    console.log('✅ PDF extraction complete');
    console.log('📝 Total extracted length:', extractedText.length);

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
    console.error('❌ PDF OCR Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'PDF extraction failed: ' + error.message
    });
  }
});

/**
 * Health check for OCR service
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
