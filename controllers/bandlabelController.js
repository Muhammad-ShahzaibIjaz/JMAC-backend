const { BandLabel } = require('../models');


const getBandLabels = async (req, res) => {
  const { templateId } = req.query;
  try {
    if (!templateId) {
      return res.status(400).json({ message: 'templateId is required.' });
    }
    const rows = await BandLabel.findAll({ where: { templateId }, raw: true });
    const financial = {};
    const academic = {};
    for (const r of rows) {
      if (r.bandType === 'financial') financial[r.bandIndex] = r.label;
      else if (r.bandType === 'academic') academic[r.bandIndex] = r.label;
    }
    return res.status(200).json({ financial, academic });
  } catch (error) {
    console.error('Error fetching band labels:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


const saveBandLabels = async (req, res) => {
  const { templateId, labels } = req.body;
  try {
    if (!templateId || !Array.isArray(labels)) {
      return res
        .status(400)
        .json({ message: 'templateId and labels[] are required.' });
    }
    for (const item of labels) {
      const { bandType, bandIndex, label } = item;
      if (
        (bandType !== 'financial' && bandType !== 'academic') ||
        !Number.isInteger(bandIndex)
      ) {
        continue;
      }
      const [row, created] = await BandLabel.findOrCreate({
        where: { templateId, bandType, bandIndex },
        defaults: { templateId, bandType, bandIndex, label: label || '' },
      });
      if (!created) {
        row.label = label || '';
        await row.save();
      }
    }
    return res.status(200).json({ message: 'Band labels saved.' });
  } catch (error) {
    console.error('Error saving band labels:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { getBandLabels, saveBandLabels };