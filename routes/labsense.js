import express from 'express';
import { 
  analyzeLabReport, 
  queryReport, 
  getUserReports,
  getReportDetails,
  healthCheck 
} from '../controllers/labsenseController.js';

const router = express.Router();

// Health check endpoint
router.get('/health', healthCheck);

// Analyze lab report text (initial upload)
router.post('/analyze', analyzeLabReport);

// Ask questions about a previously analyzed report
router.post('/query', queryReport);

// Get all reports for a user
router.get('/reports/:userId', getUserReports);

// Get specific report details
router.get('/report/:reportId/:userId', getReportDetails);

export default router;
