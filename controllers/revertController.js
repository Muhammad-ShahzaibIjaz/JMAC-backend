const SheetData = require('../models/SheetData');
const sequelize = require('../config/database');
const { DataTypes, Op } = require('sequelize');
const { OperationLog, SheetDataSnapshot, Header } = require('../models');


async function undoUpdatedRow(operationLogId) {
    const transaction = await sequelize.transaction();

    try{
        const snapshots = await SheetDataSnapshot.findAll({
            where: { operationLogId },
            transaction,
        });

        await Promise.all(snapshots.map(async (snapshot) => {
            await SheetData.update(
                { value: snapshot.originalValue },
                {
                    where: {
                        headerId: snapshot.headerId,
                        rowIndex: snapshot.rowIndex
                    },
                    transaction
                }
            );
        }));

        await transaction.commit();
    } catch(error) {
        await transaction.rollback();
        throw new Error(`Failed to undo operation: ${error.message}`);
    }
}



async function undoZipcodeOperation(operationLogId) {
  const transaction = await sequelize.transaction();
  try {
    const snapshots = await SheetDataSnapshot.findAll({
      where: { operationLogId },
      transaction
    });

    const inserts = snapshots.filter(s => s.changeType === 'INSERT');
    const updates = snapshots.filter(s => s.changeType === 'UPDATE');

    const clearPromises = inserts.map(insert => 
      SheetData.update(
        { value: null },
        {
          where: {
            headerId: insert.headerId,
            rowIndex: insert.rowIndex
          },
          transaction
        }
      )
    );

    const restorePromises = updates.map(update =>
      SheetData.update(
        { value: update.originalValue },
        {
          where: {
            headerId: update.headerId,
            rowIndex: update.rowIndex
          },
          transaction
        }
      )
    );

    await Promise.all([...clearPromises, ...restorePromises]);

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw new Error(`Failed to undo zipcode operation: ${error.message}`);
  }
}

async function deleteLatestRowData(templateId) {
  try {
    // Find maximum rowIndex for the template
    const [result] = await sequelize.query(
      `
      SELECT MAX(sd."rowIndex") as "maxRow"
      FROM "SheetData" sd
      JOIN "Header" h ON sd."headerId" = h.id
      WHERE h."templateId" = :templateId
      `,
      {
        replacements: { templateId },
        type: sequelize.QueryTypes.SELECT,
      }
    );
    const maxRow = result?.maxRow;
    if (maxRow === null || maxRow === undefined) {
      return res.status(404).json({ success: false, message: 'No data found to delete for this template' });
    }

    const deletedCount = await SheetData.destroy({
      where: {
        rowIndex: maxRow,
        headerId: {
          [Op.in]: sequelize.literal(
            `(SELECT id FROM "Header" WHERE "templateId" = '${templateId}')`
          ),
        },
      },
    });

    if (!deletedCount) {
      return res.status(404).json({ success: false, message: 'No data found for the latest row' });
    }

    return { 
      success: true, 
      message: `Deleted ${deletedCount} record(s) for rowIndex ${maxRow}` 
    };
  } catch (error) {
    console.error('Error deleting latest row data:', error);
    return { 
      success: false, 
      message: 'Failed to delete data', 
      error: error.message 
    };
  }
}


async function checkUndoOperationAvailable(req, res) {
  try{
    const { templateId } = req.params;

    if(!templateId) {
      return res.status(400).json({ error: "templateId is required" });
    }

    const latestOperation = await OperationLog.findOne({
      where: { templateId },
      order: [['createdAt', 'DESC']],
    });

    if(!latestOperation) {
      return res.status(200).json(false);
    }
    return res.status(200).json(true);
  } catch(error) {
    return res.status(500).json({ error: error.message });
  }
}


async function undoLatestOperation(req, res) {
  try {
    const { templateId } = req.params;

    if (!templateId) {
      return res.status(400).json({ error: "templateId is required" });
    }

    const latestOperation = await OperationLog.findOne({
      where: { templateId },
      order: [['createdAt', 'DESC']],
    });

    if (!latestOperation) {
      return res.status(404).json({ error: "No operations found for this template" });
    }

    if (latestOperation.operationType === 'ZIPCODE' || latestOperation.operationType === 'CONVERSION') {
      await undoZipcodeOperation(latestOperation.id);
    } else if (latestOperation.operationType === 'ADD_ROW') {
      await deleteLatestRowData(templateId);
    } else if (latestOperation.operationType === 'ADD_HEADER') {
      await undoHeaderOperation(templateId, latestOperation.id);
    } else {
      await undoUpdatedRow(latestOperation.id);
    }

    await latestOperation.destroy();

    const remainingOperations = await OperationLog.count({
      where: { templateId },
    });

    return res.status(200).json(remainingOperations > 0);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}



async function undoHeaderOperation(templateId, operationLogId) {
  const transaction = await sequelize.transaction();
  try {
    const snapshots = await SheetDataSnapshot.findAll({
      where: { operationLogId },
      transaction,
    });

    const headerId = snapshots[0].headerId;

    const header = await Header.findOne({
      where: { id: headerId, templateId },
      transaction,
    });

    if (!header) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Header not found or does not belong to the template' });
    }

    await SheetData.destroy({
      where: { headerId },
      transaction,
    });

    await Header.destroy({
      where: { id: headerId },
      transaction,
    });

    await SheetDataSnapshot.destroy({
      where: { operationLogId },
      transaction,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
  }
}


module.exports = { checkUndoOperationAvailable, undoLatestOperation }