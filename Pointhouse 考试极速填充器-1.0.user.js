// ==UserScript==
// @name         Pointhouse 考试极速填充器
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在右下角浮动面板输入答案，自动识别并极速填充三种题型。
// @author       AI
// @match        https://www.pointhouse.cn/courses/*/contents/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ----------------------------------------------------
    // ****** 核心填充逻辑 ******
    // ----------------------------------------------------

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const waitForElement = (selector, maxWait = 800, interval = 50) => new Promise(resolve => {
        const startTime = Date.now();
        const check = () => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
            } else if (Date.now() - startTime < maxWait) {
                setTimeout(check, interval);
            } else {
                resolve(null);
            }
        };
        check();
    });

    function getRadioValue(letter) {
        switch (letter.toUpperCase()) {
            case 'A': return '0';
            case 'B': return '1';
            case 'C': return '2';
            case 'D': return '3';
            default: return null;
        }
    }

    async function findQuestionType(firstInput) {
        const radioInputs = document.querySelectorAll('input[type="radio"][name]');
        if (radioInputs.length >= 20) {
            console.log("🛠 动态识别: [SELECTION_RADIO_MATCH] 模式。");
            return 'SELECTION_RADIO_MATCH';
        }

        if (!firstInput) { return 'UNKNOWN'; }

        const parentDiv = firstInput.closest('div[style*="display: inline-block"]');
        const targetElement = parentDiv || firstInput;

        targetElement.click();
        firstInput.focus();

        const dropdownContainer = await waitForElement('div[data-rsbs-overlay="true"]', 500);

        document.body.click();
        await delay(50);

        if (dropdownContainer) {
            console.log("🛠 动态识别: [TASK_WORD_MATCH] 模式 (浮窗点击)。");
            return 'TASK_WORD_MATCH';
        } else {
            console.log("🛠 动态识别: [PASSAGE_LETTER_INJECTION] 模式 (字母注入)。");
            return 'PASSAGE_LETTER_INJECTION';
        }
    }

    async function fillByClickingOption(name, answerLetter) {
        const MAX_WAIT_TIME = 800;
        const inputElements = document.getElementsByName(name);
        const input = inputElements.length > 0 ? inputElements[0] : null;
        if (!input) return 0;

        const parentDiv = input.closest('div[style*="display: inline-block"]');
        const targetElement = parentDiv || input;

        try {
            targetElement.click();
            input.focus();
            const dropdownContainer = await waitForElement('div[data-rsbs-overlay="true"]', MAX_WAIT_TIME);

            if (!dropdownContainer) { return 0; }

            const optionSelector = `span[class*="_tag_"]`;
            const allOptions = dropdownContainer.querySelectorAll(optionSelector);
            let targetOption = null;

            if (allOptions.length > 0) {
                const optionIndex = answerLetter.charCodeAt(0) - 'A'.charCodeAt(0);
                if (optionIndex >= 0 && optionIndex < allOptions.length) {
                    targetOption = allOptions[optionIndex];
                }
            }

            if (targetOption) {
                targetOption.click();

                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
                });
                input.dispatchEvent(enterEvent);
                input.blur();

                console.log(`✔ 成功填充 [浮窗]: ${name} -> ${answerLetter}`);
                return 1;
            } else {
                console.warn(`⚠ 警告: 浮窗中找不到选项 ${answerLetter}。跳过 ${name}`);
                return 0;
            }

        } catch (e) {
            console.error(`✘ 填充 ${name} 时发生异常:`, e);
            return 0;
        } finally {
            document.body.click();
            await delay(50);
        }
    }

    async function fillByInjectingLetter(name, answerLetter) {
        const inputElements = document.getElementsByName(name);
        const input = inputElements.length > 0 ? inputElements[0] : null;
        if (!input) return 0;

        try {
            Object.defineProperty(input, 'value', { value: answerLetter, writable: true, configurable: true });
            input.value = answerLetter;

            input.dispatchEvent(new Event('input', { bubbles: true }));
            await delay(20);
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(20);

            input.blur();

            console.log(`✔ 成功填充 [注入]: ${name} -> ${answerLetter}`);
            return 1;

        } catch (e) {
            console.error(`✘ 填充 ${name} 时发生异常:`, e);
            return 0;
        }
    }

    function fillByClickingRadio(CORRECT_ANSWERS_ARRAY) {
        const totalAnswers = CORRECT_ANSWERS_ARRAY.length;
        let filledCount = 0;

        const allRadioInputs = document.querySelectorAll('input[type="radio"][name]');

        const questionMap = new Map();
        allRadioInputs.forEach(input => {
            if (!questionMap.has(input.name) && !isNaN(parseInt(input.name))) {
                questionMap.set(input.name, input);
            }
        });

        let questionEntries = Array.from(questionMap.entries());
        questionEntries.sort(([, inputA], [, inputB]) => {
            return inputA.compareDocumentPosition(inputB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });

        const questionNames = questionEntries.map(([name,]) => name);

        if (questionNames.length !== totalAnswers) {
            console.warn(`⚠ 警告: 实际识别到 ${questionNames.length} 组题目，与答案数量 (${totalAnswers}) 不匹配。`);
        } else {
            console.log(`🔍 成功识别 ${questionNames.length} 组 Radio 题目。`);
        }

        for (let i = 0; i < totalAnswers; i++) {
            const answerLetter = CORRECT_ANSWERS_ARRAY[i];
            const questionName = questionNames[i];

            if (!questionName) continue;

            const targetValue = getRadioValue(answerLetter);

            if (targetValue === null) continue;

            const selector = `input[name="${questionName}"][type="radio"][value="${targetValue}"]`;
            const targetRadioInput = document.querySelector(selector);

            if (targetRadioInput) {
                try {
                    const label = targetRadioInput.closest('label');
                    if (label && !targetRadioInput.checked) {
                        label.click();
                        targetRadioInput.dispatchEvent(new Event('change', { bubbles: true }));

                        console.log(`✔ 成功填充 [Radio]: 第 ${i + 1} 题 (Name:${questionName}) -> ${answerLetter}`);
                        filledCount++;
                    } else if (targetRadioInput.checked) {
                        filledCount++;
                    }
                } catch (e) {
                    console.error(`✘ 点击第 ${i + 1} 题选项 ${answerLetter} 时发生异常:`, e);
                }
            }
        }
        return filledCount;
    }


    async function FillAnswer(CORRECT_ANSWERS_ARRAY, logElement) {
        logElement.innerHTML = `<div>🔍 正在识别题型...</div>`;

        const allInputs = document.querySelectorAll('input[name]');
        let firstInput = allInputs.length > 0 ? allInputs[0] : null;

        const questionType = await findQuestionType(firstInput);

        let filledCount = 0;
        const totalAnswers = CORRECT_ANSWERS_ARRAY.length;

        logElement.innerHTML = `<div>✅ 识别完成。模式：**${questionType}**，共 ${totalAnswers} 题。开始填充...</div>`;

        if (questionType === 'SELECTION_RADIO_MATCH') {
            filledCount = fillByClickingRadio(CORRECT_ANSWERS_ARRAY);
            logElement.innerHTML = `<div style="color: green;">🎉 填充完成！总共 ${totalAnswers} 题，成功填充 ${filledCount} 题。</div>`;

        } else if (questionType === 'TASK_WORD_MATCH' || questionType === 'PASSAGE_LETTER_INJECTION') {
            if (!firstInput) return;

            let prefixId = 'Q';
            const firstInputName = firstInput.name;

            const nameParts = firstInputName.split('-');
            if (nameParts.length > 1) {
                prefixId = nameParts[0];
            } else if (firstInputName.match(/\d/)) {
                prefixId = firstInputName.replace(/[^a-zA-Z]/g, '');
                if (prefixId === firstInputName) { prefixId = 'Q'; }
            }

            const fillFunction = (questionType === 'TASK_WORD_MATCH')
                                 ? fillByClickingOption
                                 : fillByInjectingLetter;

            for (let i = 0; i < totalAnswers; i++) {
                let name;
                if (firstInputName.includes('-')) {
                     name = `${prefixId}-${i}`;
                } else {
                     name = `${prefixId}${i}`;
                }

                const answerLetter = CORRECT_ANSWERS_ARRAY[i];

                const success = await fillFunction(name, answerLetter);
                filledCount += success;
                logElement.innerHTML = `<div>✅ 模式：**${questionType}**，共 ${totalAnswers} 题。已完成 ${i + 1} / ${totalAnswers} 题。</div>`;
            }

            logElement.innerHTML = `<div style="color: green;">🎉 填充完成！总共 ${totalAnswers} 题，成功填充 ${filledCount} 题。</div>`;

        } else {
             logElement.innerHTML = `<div style="color: red;">✘ 填充失败：无法识别题型或没有找到足够的元素。</div>`;
             return;
        }
    }

    // ----------------------------------------------------
    // ****** GUI 界面和启动逻辑 ******
    // ----------------------------------------------------

    function createGUI() {
        // --- 1. 创建主容器 ---
        const container = document.createElement('div');
        container.id = 'pointhouse-filler-gui';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 300px;
            padding: 10px;
            background-color: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 99999;
            font-family: Arial, sans-serif;
            font-size: 14px;
        `;

        // --- 2. 创建标题 ---
        container.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 10px; color: #1890ff;">
                Pointhouse 填充器
            </div>
            <div style="margin-bottom: 8px; font-size: 12px;">
                请输入答案串（5或10个字母）：
            </div>
        `;

        // --- 3. 创建输入框 ---
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '例： CBBAD 或 DIKGJACLFH';
        input.style.cssText = `
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-sizing: border-box;
        `;
        container.appendChild(input);

        // --- 4. 创建按钮 ---
        const button = document.createElement('button');
        button.textContent = '开始填充';
        button.style.cssText = `
            width: 100%;
            padding: 8px;
            background-color: #52c41a;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.3s;
        `;
        button.onmouseover = () => button.style.backgroundColor = '#73d13d';
        button.onmouseout = () => button.style.backgroundColor = '#52c41a';
        container.appendChild(button);

        // --- 5. 创建日志/状态显示区 ---
        const log = document.createElement('div');
        log.id = 'filler-log';
        log.style.cssText = `
            margin-top: 10px;
            padding: 8px;
            min-height: 30px;
            border: 1px solid #f0f0f0;
            background-color: #fafafa;
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.4;
            color: #333;
        `;
        log.innerHTML = '<div>💡 脚本已就绪。</div>';
        container.appendChild(log);

        // --- 6. 绑定点击事件 ---
        button.addEventListener('click', () => {
            const answerString = input.value.trim();
            if (answerString.length === 0) {
                log.innerHTML = `<div style="color: red;">✘ 请输入答案！</div>`;
                return;
            }

            const requiredAnswers = answerString.toUpperCase().split('');
            log.innerHTML = `<div style="color: #faad14;">🚀 正在运行，请勿操作页面...</div>`;
            button.disabled = true;

            // 执行填充逻辑
            FillAnswer(requiredAnswers, log).finally(() => {
                button.disabled = false;
            });
        });

        // --- 7. 将容器添加到页面 ---
        document.body.appendChild(container);
    }

    // 在页面加载完成后启动 GUI
    window.addEventListener('load', () => {
        setTimeout(createGUI, 1000);
    });

})();