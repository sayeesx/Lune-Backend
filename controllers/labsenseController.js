import { getGroqJSON, queryLabReport } from '../utils/groqClient.js';
import LabReport from '../models/LabReport.js';
import mongoose from 'mongoose';  // ← Add this line

/**
 * Analyze lab report text using Groq AI and save to MongoDB
 * POST /api/labsense/analyze
 * Body: { text: string, userId: string }
 */
export const analyzeLabReport = async (req, res) => {
  try {
    const { text, userId } = req.body;

    // Validation
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Lab report text is required'
      });
    }

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Limit text size (prevent abuse)
    if (text.length > 50000) {
      return res.status(400).json({
        success: false,
        error: 'Lab report text too large (max 50,000 characters)'
      });
    }

    // System prompt for medical lab analysis
    const systemPrompt = `You are Labsense, an AI medical lab report companion.
Analyze the provided lab report and return a structured JSON response.

Your JSON response MUST have exactly these fields:
{
  "summary": "A clear 2-3 sentence summary of key findings",
  "abnormalities": [
    {
      "testName": "Name of the test",
      "value": "Measured value with unit",
      "normalRange": "Normal reference range",
      "severity": "low, moderate, high, or critical"
    }
  ],
  "recommendations": [
    "Specific, actionable health recommendation 1",
    "Specific, actionable health recommendation 2",
    "Specific, actionable health recommendation 3"
  ],
  "riskLevel": "low, moderate, high, or critical"
}

Important guidelines:
- Be precise and factual
- Prioritize patient safety in all recommendations
- Include ALL abnormal findings in the abnormalities array
- Provide 3-5 specific, actionable recommendations
- Assess overall riskLevel based on severity of findings
- Output in structured JSON with educational intent
- This is not a medical diagnosis`;

    const userPrompt = `Analyze this lab report:\n\n${text}`;

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    console.log('🔵 Calling Groq AI for analysis...');
    
    // Call Groq API with JSON mode
    const analysis = await getGroqJSON(messages, {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      maxTokens: 2000,
      topP: 0.9
    });

    // Validate response structure
    if (!analysis || typeof analysis !== 'object') {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate valid analysis. Please try again.'
      });
    }

    console.log('✅ Groq analysis complete');
    console.log('🔵 Saving to MongoDB...');

    // Save to MongoDB
    const labReport = new LabReport({
      userId,
      labText: text,
      reportSummary: analysis.summary || 'Lab report analysis completed.',
      abnormalities: Array.isArray(analysis.abnormalities) ? analysis.abnormalities : [],
      recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
      riskLevel: analysis.riskLevel || 'low',
      queries: [] // Initialize empty queries array
    });

    await labReport.save();
    
    console.log('✅ Saved to MongoDB! Report ID:', labReport._id);
    console.log('📊 Database:', mongoose.connection.name);
    console.log('📁 Collection: labreports');

    // Return structured response
    return res.status(200).json({
      success: true,
      data: {
        reportId: labReport._id,
        summary: labReport.reportSummary,
        abnormalities: labReport.abnormalities,
        recommendations: labReport.recommendations,
        riskLevel: labReport.riskLevel,
        timestamp: labReport.timestamp
      }
    });

  } catch (error) {
    console.error('❌ LabSense Analysis Error:', error);

    // Handle specific error messages
    if (error.message === 'AI service error. Please try again later.') {
      return res.status(503).json({
        success: false,
        error: 'AI service temporarily unavailable. Please try again.'
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Please check your input.'
      });
    }

    // Generic error response
    return res.status(500).json({
      success: false,
      error: 'Failed to analyze lab report. Please try again.'
    });
  }
};

/**
 * Ask questions about a previously analyzed lab report
 * POST /api/labsense/query
 * Body: { reportId: string, question: string, userId: string }
 */
export const queryReport = async (req, res) => {
  try {
    const { reportId, question, userId } = req.body;

    // Validation
    if (!reportId || typeof reportId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Report ID is required'
      });
    }

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Question is required'
      });
    }

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (question.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Question too long (max 500 characters)'
      });
    }

    console.log('🔍 Fetching report from MongoDB:', reportId);

    // Fetch lab report from MongoDB
    const labReport = await LabReport.findOne({ 
      _id: reportId, 
      userId // Ensure user owns this report
    });

    if (!labReport) {
      return res.status(404).json({
        success: false,
        error: 'Lab report not found or access denied'
      });
    }

    console.log('✅ Report found');

    // Check if this question was already asked (cache check)
    const cachedAnswer = labReport.findCachedAnswer(question);
    
    if (cachedAnswer) {
      console.log('💾 Returning cached answer (no API call)');
      return res.status(200).json({
        success: true,
        data: {
          answer: cachedAnswer.answer,
          relevant_section: cachedAnswer.relevant_section,
          ai_note: cachedAnswer.ai_note,
          cached: true,
          timestamp: cachedAnswer.createdAt
        }
      });
    }

    console.log('🔵 Calling Groq AI for answer...');

    // Query Groq AI with the stored lab text
    const response = await queryLabReport(labReport.labText, question);

    // Validate response
    if (!response || typeof response !== 'object') {
      return res.status(500).json({
        success: false,
        error: 'Failed to process your question. Please try again.'
      });
    }

    console.log('✅ Groq response received');
    console.log('🔵 Caching answer in MongoDB...');

    // Save the Q&A to MongoDB (cache for future)
    labReport.queries.push({
      question: question.trim(),
      answer: response.answer || 'I apologize, but I could not generate a response.',
      relevant_section: response.relevant_section || null,
      ai_note: response.ai_note || 'AI-generated insights — not a medical diagnosis.'
    });

    await labReport.save();
    console.log('✅ Answer cached');

    // Return structured response
    return res.status(200).json({
      success: true,
      data: {
        answer: response.answer,
        relevant_section: response.relevant_section || null,
        ai_note: response.ai_note || 'AI-generated insights — not a medical diagnosis.',
        cached: false,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ LabSense Query Error:', error);

    if (error.message === 'AI service error. Please try again later.') {
      return res.status(503).json({
        success: false,
        error: 'AI service temporarily unavailable. Please try again.'
      });
    }

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid report ID format'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to answer your question. Please try again.'
    });
  }
};

/**
 * Get all lab reports for a user
 * GET /api/labsense/reports/:userId
 */
export const getUserReports = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Fetch all reports for this user, sorted by newest first
    const reports = await LabReport.find({ userId })
      .select('_id reportSummary riskLevel timestamp abnormalities')
      .sort({ timestamp: -1 })
      .limit(50); // Limit to last 50 reports

    return res.status(200).json({
      success: true,
      data: {
        reports,
        count: reports.length
      }
    });

  } catch (error) {
    console.error('Get Reports Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch reports'
    });
  }
};

/**
 * Get specific lab report details
 * GET /api/labsense/report/:reportId/:userId
 */
export const getReportDetails = async (req, res) => {
  try {
    const { reportId, userId } = req.params;

    const report = await LabReport.findOne({ 
      _id: reportId, 
      userId 
    });

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: report
    });

  } catch (error) {
    console.error('Get Report Details Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch report details'
    });
  }
};

/**
 * Health check endpoint
 * GET /api/labsense/health
 */
export const healthCheck = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'LabSense API is running',
    model: 'llama-3.3-70b-versatile',
    database: 'MongoDB',
    timestamp: new Date().toISOString()
  });
};
