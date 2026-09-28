/* seed.js —— 首次打开时的内置初始数据
 *
 * 来源：套卷复盘137788287964941447.1e985b7db4385be(2).xlsx
 *       仅 Sheet1「粉笔模考」第 3~7 行（该表目前只有这一套记录）。
 *
 * 浏览器在 file:// 下无法读取同目录的 xlsx（受 CORS 限制），
 * 所以把这条真实数据内置为初始数据，保证「双击 HTML 即可看到原有套卷」。
 * 之后再导入同一个 xlsx 时，会被「日期 + 试卷」去重逻辑拦下。
 *
 * raw 字段保存了 Sheet1 五行的原始单元格值，用于导出时逐格还原，
 * 避免丢失源表中「合计 76 与模块之和 81 不一致」「言语理解总用时 38 与子模块之和 37 不一致」
 * 「正确率列存在 50%% 这类脏数据」等真实信息。
 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var SEED_RECORDS = [
    {
      id: 'seed-0001-4f3a-9c21-8b7d6e5a4c3b',
      date: '2026-09-19',
      paperName: '第29季',
      score: 58.5,
      averageScore: 57.3,
      defeatRate: 59.4,
      total: { questions: 130, correct: 76, accuracy: 58.46, time: 176 },
      modules: {
        political: { name: '政治理论', questions: 20, correct: 6, accuracy: 30, avgAccuracy: 70, time: 11 },
        common:    { name: '常识',     questions: 15, correct: 10, accuracy: 66.67, avgAccuracy: 60, time: null },
        language: {
          name: '言语理解', questions: 30, correct: 20, accuracy: 66.67, avgAccuracy: 70, time: 37,
          subModules: {
            logicalCloze: { name: '逻辑填空', questions: 15, correct: 9, accuracy: 60,   avgAccuracy: null, time: 17 },
            reading:      { name: '片段阅读', questions: 10, correct: 7, accuracy: 70,   avgAccuracy: null, time: 15 },
            sentence:     { name: '语句表达', questions: 5,  correct: 4, accuracy: 80,   avgAccuracy: null, time: 5  }
          }
        },
        quantity:  { name: '数量关系', questions: 10, correct: 5,  accuracy: 50, avgAccuracy: 60, time: 10 },
        reasoning: {
          name: '判断推理', questions: 35, correct: 20, accuracy: 57.14, avgAccuracy: 67, time: 35,
          subModules: {
            graphic:    { name: '图形推理', questions: 10, correct: 5, accuracy: 50,  avgAccuracy: null, time: 10 },
            definition: { name: '定义判断', questions: 10, correct: 5, accuracy: 50,  avgAccuracy: null, time: 10 },
            analogy:    { name: '类比推理', questions: 5,  correct: 5, accuracy: 100, avgAccuracy: null, time: 5  },
            logic:      { name: '逻辑判断', questions: 10, correct: 5, accuracy: 50,  avgAccuracy: null, time: 10 }
          }
        },
        dataAnalysis: { name: '资料分析', questions: 20, correct: 20, accuracy: 100, avgAccuracy: 100, time: 60 }
      },
      raw: {
        '总题数':     { G: 130, H: 20, I: 15, J: 15, K: 10, L: 5, M: 30, N: 10, O: 10, P: 10, Q: 5,  R: 10, S: 35, T: 20 },
        '正确题数':   { A: '2026-09-19', B: '第29季', C: 58.5, D: 57.3, E: 0.594, G: 76, H: 6, I: 10, J: 9, K: 7, L: 4, M: 20, N: 5, O: 5, P: 5, Q: 5, R: 5, S: 20, T: 20 },
        '正确率':     { H: 0.3, I: 0.67, J: 0.6, K: 0.7, L: 0.8, M: 0.67, N: 0.5, O: '50%%', P: '50%%', Q: '100%%', R: '50%%', S: 0.5715, T: 1 },
        '平均正确率': { H: 0.7, I: 0.6, J: '无', M: 0.7, N: 0.6, O: '无', S: 0.67, T: 1 },
        '用时':       { G: 176, H: 11, J: 17, K: 15, L: 5, M: 38, N: 10, O: 10, P: 10, Q: 5, R: 10, S: 35, T: 60 }
      },
      createdAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-19T00:00:00.000Z'
    }
  ];

  KG.Seed = { records: SEED_RECORDS };
})();
