// Concordance data from 2018 ACT/SAT Tables
const compositeACTtoSAT = {
    36: { single: 1590, range: [1570, 1600] }, 35: { single: 1540, range: [1530, 1560] },
    34: { single: 1500, range: [1490, 1520] }, 33: { single: 1460, range: [1450, 1480] },
    32: { single: 1430, range: [1420, 1440] }, 31: { single: 1400, range: [1390, 1410] },
    30: { single: 1370, range: [1360, 1380] }, 29: { single: 1340, range: [1330, 1350] },
    28: { single: 1310, range: [1300, 1320] }, 27: { single: 1280, range: [1260, 1290] },
    26: { single: 1240, range: [1230, 1250] }, 25: { single: 1210, range: [1200, 1220] },
    24: { single: 1180, range: [1160, 1190] }, 23: { single: 1140, range: [1130, 1150] },
    22: { single: 1110, range: [1100, 1120] }, 21: { single: 1080, range: [1060, 1090] },
    20: { single: 1040, range: [1030, 1050] }, 19: { single: 1010, range: [990, 1020] },
    18: { single: 970, range: [960, 980] }, 17: { single: 930, range: [920, 950] },
    16: { single: 890, range: [880, 910] }, 15: { single: 850, range: [830, 870] },
    14: { single: 800, range: [780, 820] }, 13: { single: 760, range: [730, 770] },
    12: { single: 710, range: [690, 720] }, 11: { single: 670, range: [650, 680] },
    10: { single: 630, range: [620, 640] }, 9: { single: 590, range: [590, 610] }
};

const compositeSATtoACT = {
    1600: 36, 1590: 36, 1580: 36, 1570: 36, 1560: 35, 1550: 35, 1540: 35, 1530: 35,
    1520: 34, 1510: 34, 1500: 34, 1490: 34, 1480: 33, 1470: 33, 1460: 33, 1450: 33,
    1440: 32, 1430: 32, 1420: 32, 1410: 31, 1400: 31, 1390: 31, 1380: 30, 1370: 30,
    1360: 30, 1350: 29, 1340: 29, 1330: 29, 1320: 28, 1310: 28, 1300: 28, 1290: 27,
    1280: 27, 1270: 27, 1260: 27, 1250: 26, 1240: 26, 1230: 26, 1220: 25, 1210: 25,
    1200: 25, 1190: 24, 1180: 24, 1170: 24, 1160: 24, 1150: 23, 1140: 23, 1130: 23,
    1120: 22, 1110: 22, 1100: 22, 1090: 21, 1080: 21, 1070: 21, 1060: 21, 1050: 20,
    1040: 20, 1030: 20, 1020: 19, 1010: 19, 1000: 19, 990: 19, 980: 18, 970: 18,
    960: 18, 950: 17, 940: 17, 930: 17, 920: 17, 910: 16, 900: 16, 880: 16, 870: 15,
    860: 15, 850: 15, 840: 15, 830: 15, 820: 14, 810: 14, 800: 14, 790: 14, 780: 14,
    770: 13, 760: 13, 750: 13, 740: 13, 730: 13, 720: 12, 710: 12, 700: 12, 690: 12,
    680: 11, 670: 11, 660: 11, 650: 11, 640: 10, 630: 10, 620: 10, 610: 9, 600: 9, 590: 9
};

const mathACTtoSAT = {
    36: 800, 35: 780, 34: 760, 33: 740, 32: 720, 31: 710, 30: 700, 29: 680, 28: 660,
    27: 640, 26: 610, 25: 590, 24: 580, 23: 560, 22: 540, 21: 530, 20: 520, 19: 510,
    18: 500, 17: 470, 16: 430, 15: 400, 14: 360, 13: 330, 12: 310, 11: 280, 10: 260
};

const mathSATtoACT = {
    800: 36, 790: 35, 780: 35, 770: 35, 760: 34, 750: 33, 740: 33, 730: 32, 720: 32,
    710: 31, 700: 30, 690: 30, 680: 29, 670: 28, 660: 28, 650: 27, 640: 27, 630: 27,
    620: 26, 610: 26, 600: 25, 590: 25, 580: 24, 570: 24, 560: 23, 550: 23, 540: 22,
    530: 21, 520: 20, 510: 19, 500: 18, 490: 18, 480: 17, 470: 17, 460: 17, 450: 16,
    440: 16, 430: 16, 420: 16, 410: 15, 400: 15, 390: 15, 380: 15, 370: 14, 360: 14,
    350: 14, 340: 13, 330: 13, 320: 13, 310: 12, 300: 12, 290: 11, 280: 11, 270: 10, 260: 10
};

const englishReadingACTtoSAT = {
    72: 790, 71: 770, 70: 750, 69: 740, 68: 730, 67: 720, 66: 710, 65: 700, 64: 700,
    63: 690, 62: 680, 61: 680, 60: 670, 59: 660, 58: 660, 57: 650, 56: 640, 55: 640,
    54: 630, 53: 630, 51: 610, 50: 520, 49: 510, 48: 590, 47: 580, 46: 580, 45: 570,
    44: 560, 43: 550, 42: 540, 41: 540, 40: 520, 39: 520, 38: 510, 37: 500, 36: 500,
    35: 490, 34: 480, 33: 470, 32: 460, 31: 450, 30: 440, 29: 430, 28: 420, 27: 410,
    26: 400, 25: 390, 24: 380, 23: 370, 22: 360, 21: 350, 20: 340, 19: 330, 18: 320,
    17: 310, 16: 300, 15: 290, 14: 280
};

const englishReadingSATtoACT = {
    800: 72, 790: 72, 780: 71, 770: 71, 760: 70, 750: 70, 740: 69, 730: 68, 720: 67,
    710: 66, 700: 64, 690: 63, 680: 61, 670: 60, 660: 58, 650: 57, 640: 55, 630: 54,
    620: 52, 610: 51, 600: 49, 590: 48, 580: 46, 570: 45, 560: 44, 550: 43, 540: 42,
    530: 40, 520: 39, 510: 38, 500: 37, 490: 35, 480: 34, 470: 33, 460: 32, 450: 31,
    440: 30, 430: 29, 420: 28, 410: 27, 400: 26, 390: 25, 380: 24, 370: 23, 360: 22,
    350: 21, 340: 20, 330: 19, 320: 18, 310: 17, 300: 16, 290: 15, 280: 14
};


function convertScore(subject, testType, score) {
    if(!['Composite', 'Math', 'ERW', 'English+Reading'].includes(subject)) {
        return null;
    }
    if(!['ACT', 'SAT'].includes(testType)) {
        return null;
    }

    let result = null;
    try {
        if (subject === 'Composite') {
            if (testType === 'ACT') {
                if (score < 9 || score > 36) {
                    result = { single: 590, range: [590, 610] };
                } else {
                    result = compositeACTtoSAT[score] || { error: 'No conversion available for this ACT Composite score.' };
                }
            } else {
                if (score < 590 || score > 1600) {
                    result = { single: 9, range: [590, 590] };
                } else {
                    result = { single: compositeSATtoACT[score], range: [score, score] };
                    if (!result.single) throw new Error('No conversion available for this SAT Total score.');
                }
            }
        } else if (subject === 'Math') {
            if (testType === 'ACT') {
                if (score < 10 || score > 36) {
                    result = { single: 260, range: [260, 260] };
                } else {
                    result = { single: mathACTtoSAT[score], range: [mathACTtoSAT[score], mathACTtoSAT[score]] };
                    if (!result.single) throw new Error('No conversion available for this ACT Math score.');
                }
            } else {
                if (score < 260 || score > 800) {
                    result = { single: 10, range: [260, 260] };
                } else {
                    result = { single: mathSATtoACT[score], range: [score, score] };
                    if (!result.single) throw new Error('No conversion available for this SAT Math score.');
                }
            }
        } else if (subject === 'ERW' || subject === 'English+Reading') {
            if (testType === 'ACT' && subject !== 'English+Reading') {
                throw new Error('Use "English+Reading" for ACT, not "ERW".');
            }
            if (testType === 'SAT' && subject !== 'ERW') {
                throw new Error('Use "ERW" for SAT, not "English+Reading".');
            }
            if (testType === 'ACT') {
                if (score < 14 || score > 72) {
                    result = { single: 280, range: [280, 280] };
                } else {
                    result = { single: englishReadingACTtoSAT[score], range: [englishReadingACTtoSAT[score], englishReadingACTtoSAT[score]] };
                    if (!result.single) throw new Error('No conversion available for this ACT English+Reading score.');
                }
            } else {
                if (score < 280 || score > 800) {
                    result = { single: 14, range: [280, 280] };
                } else {
                    result = { single: englishReadingSATtoACT[score], range: [score, score] };
                    if (!result.single) throw new Error('No conversion available for this SAT ERW score.');
                }
            }
        }
    } catch (error) {
        return { error: error.message };
    }

    return result;
}


module.exports = { convertScore }