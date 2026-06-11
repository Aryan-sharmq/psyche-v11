const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:     { type: String, required: true, trim: true },
  passHash: { type: String, required: true },
  createdAt:{ type: Date, default: Date.now }
});

// One snapshot per analysis — the unit of the Evolution feature
const AnalysisSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  textHash: { type: String, index: true },
  inputText:{ type: String },               // first 1200 chars kept for context
  engine:   { type: String, enum: ['claude', 'rules'], default: 'rules' },
  engineVersion: { type: Number, default: 0, index: true },
  label:    { type: String, default: '' },  // optional user label e.g. "after exams"
  result:   { type: Object, required: true },// {prism, archetype, traits, shadow, emergent, narrative}
  createdAt:{ type: Date, default: Date.now, index: true }
});

const ShareSchema = new mongoose.Schema({
  shareId:  { type: String, required: true, unique: true },
  owner:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  payload:  { type: Object, required: true },
  createdAt:{ type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 }
});

module.exports = {
  User:     mongoose.model('User', UserSchema),
  Analysis: mongoose.model('Analysis', AnalysisSchema),
  Share:    mongoose.model('Share', ShareSchema)
};
