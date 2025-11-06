import mongoose from 'mongoose';

// Subdocument schema for Q&A queries
const QuerySchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  answer: {
    type: String,
    required: true
  },
  relevant_section: {
    type: String,
    default: null
  },
  ai_note: {
    type: String,
    default: 'AI-generated insights — not a medical diagnosis. Consult your doctor for personalized advice.'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// Main LabReport schema
const LabReportSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true  // Index for faster queries by user
  },
  labText: {
    type: String,
    required: true
  },
  reportSummary: {
    type: String,
    default: null
  },
  abnormalities: [{
    testName: String,
    value: String,
    normalRange: String,
    severity: {
      type: String,
      enum: ['low', 'moderate', 'high', 'critical'],
      default: 'low'
    }
  }],
  recommendations: [String],
  riskLevel: {
    type: String,
    enum: ['low', 'moderate', 'high', 'critical'],
    default: 'low'
  },
  queries: [QuerySchema],
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true  // Adds createdAt and updatedAt automatically
});

// Index for efficient queries
LabReportSchema.index({ userId: 1, timestamp: -1 });

// Method to find cached answer
LabReportSchema.methods.findCachedAnswer = function(question) {
  const normalizedQuestion = question.trim().toLowerCase();
  return this.queries.find(q => 
    q.question.trim().toLowerCase() === normalizedQuestion
  );
};

export default mongoose.model('LabReport', LabReportSchema);
