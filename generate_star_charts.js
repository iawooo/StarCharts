import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';

// 解析环境变量中的项目地址
function parseRepoUrls() {
  const repoUrls = process.env.REPOS ? process.env.REPOS.split(',').map(url => url.trim()) : [];
  if (repoUrls.length === 0) {
    console.error('❌ 环境变量 REPOS 未设置或为空，请提供项目地址！');
    return [];
  }

  const repos = repoUrls
    .map(url => {
      const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) {
        console.error(`❌ 无效的项目地址: ${url}`);
        return null;
      }
      return `${match[1]}/${match[2]}`;
    })
    .filter(repo => repo);

  console.log(`✅ 解析到 ${repos.length} 个有效项目:`, repos);
  return repos;
}

// 获取单个仓库的星标数据
async function fetchStargazers(repo) {
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('❌ 缺少 GH_TOKEN 环境变量，请设置后再运行！');
    return [];
  }

  let allStargazers = [];
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      console.log(`📡 正在获取 ${repo} 第 ${page} 页星标数据...`);
      const response = await fetch(
        `https://api.github.com/repos/${repo}/stargazers?per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3.star+json',
            'User-Agent': 'StarChartGenerator',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        // 改进错误处理：抛出异常而不是返回空数组
        throw new Error(`获取 ${repo} 星标失败: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const stargazers = await response.json();
      allStargazers = allStargazers.concat(stargazers);
      if (stargazers.length < perPage) break;
      page++;
    }

    console.log(`✅ 成功获取 ${repo} 的 ${allStargazers.length} 条星标数据`);
    return allStargazers;
  } catch (err) {
    console.error(`❌ 获取 ${repo} 星标时发生错误:`, err.message);
    // 将错误继续向上抛出
    throw err;
  }
}

// 获取单个仓库的创建日期
async function fetchRepoCreationDate(repo) {
    const token = process.env.GH_TOKEN;
    if (!token) {
      console.warn('⚠️ GH_TOKEN 未设置，可能会遇到 API 速率限制');
    }
  
    try {
      console.log(`📡 正在获取 ${repo} 的创建日期...`);
      const response = await fetch(
        `https://api.github.com/repos/${repo}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'StarChartGenerator',
          },
        }
      );
  
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`获取 ${repo} 创建日期失败: ${response.status} ${response.statusText} - ${errorText}`);
      }
  
      const repoData = await response.json();
      console.log(`✅ 成功获取 ${repo} 的创建日期: ${repoData.created_at}`);
      return new Date(repoData.created_at);
    } catch (err) {
      console.error(`❌ 获取 ${repo} 创建日期时发生错误:`, err.message);
      throw err; // 抛出错误，让上层处理
    }
}


// 计算日期的周数（ISO 8601 周编号）
function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

// 生成单个项目的星标图表
async function generateChartForRepo(repo) {
  console.log(`🚀 开始生成 ${repo} 的图表`);
  try {
    // 并行获取 star 数据和仓库创建日期
    const [stargazers, creationDate] = await Promise.all([
      fetchStargazers(repo),
      fetchRepoCreationDate(repo)
    ]);

    const earliestDate = creationDate;
    const now = new Date();
    const totalDays = Math.ceil((now - earliestDate) / (1000 * 60 * 60 * 24));
    console.log(`📊 ${repo} 总天数 (自创建以来): ${totalDays}`);

    let unit;
    let labels = [];
    let starCounts = [];

    // 按天、周、月、年生成基础数据
    if (totalDays >= 0 && totalDays < 30) {
      unit = 'day';
      starCounts = Array(totalDays).fill(0);
      for (let i = 0; i < totalDays; i++) {
        const date = new Date(earliestDate);
        date.setDate(earliestDate.getDate() + i);
        const dayStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
        labels.push(dayStr);
        const count = stargazers.filter(star => {
          const starDate = new Date(star.starred_at);
          return starDate.toDateString() === date.toDateString();
        }).length;
        starCounts[i] = count;
      }
    } else if (totalDays >= 30 && totalDays < 180) {
      unit = 'week';
      const weeksDiff = Math.ceil(totalDays / 7);
      starCounts = Array(weeksDiff).fill(0);
      for (let i = 0; i < weeksDiff; i++) {
        const startOfWeek = new Date(earliestDate);
        startOfWeek.setDate(earliestDate.getDate() + i * 7);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const weekStr = getWeekNumber(startOfWeek);
        labels.push(weekStr);
        const count = stargazers.filter(star => {
          const starDate = new Date(star.starred_at);
          return starDate >= startOfWeek && starDate <= endOfWeek;
        }).length;
        starCounts[i] = count;
      }
    } else if (totalDays >= 180 && totalDays < 1000) {
      unit = 'month';
      const monthsDiff = (now.getFullYear() - earliestDate.getFullYear()) * 12 + (now.getMonth() - earliestDate.getMonth()) + 1;
      starCounts = Array(monthsDiff).fill(0);
      for (let i = 0; i < monthsDiff; i++) {
        const date = new Date(earliestDate.getFullYear(), earliestDate.getMonth() + i, 1);
        const monthStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        labels.push(monthStr);
        const count = stargazers.filter(star => {
          const starDate = new Date(star.starred_at);
          return starDate.getFullYear() === date.getFullYear() && starDate.getMonth() === date.getMonth();
        }).length;
        starCounts[i] = count;
      }
    } else if (totalDays >= 1000) {
      unit = 'year';
      const yearsDiff = now.getFullYear() - earliestDate.getFullYear() + 1;
      starCounts = Array(yearsDiff).fill(0);
      for (let i = 0; i < yearsDiff; i++) {
        const year = earliestDate.getFullYear() + i;
        labels.push(year.toString());
        const count = stargazers.filter(star => {
          const starDate = new Date(star.starred_at);
          return starDate.getFullYear() === year;
        }).length;
        starCounts[i] = count;
      }
    } else {
        console.error(`❌ ${repo} 时间跨度无效，跳过图表生成`);
        return null;
    }

    // --- 核心修改在这里 ---
    // 在计算累加数据前，手动将创建日期和 0 计数值插入到数组的最前面
    const creationDateStr = `${creationDate.getFullYear()}-${(creationDate.getMonth() + 1).toString().padStart(2, '0')}-${creationDate.getDate().toString().padStart(2, '0')}`;
    labels.unshift(creationDateStr);
    starCounts.unshift(0);
    // --- 修改结束 ---

    // 累加星标数量，生成趋势数据
    for (let i = 1; i < starCounts.length; i++) {
      starCounts[i] += starCounts[i - 1];
    }
    
    // 修正：添加 "Now" 数据点，并使用最准确的 star 总数
    labels.push('Now');
    starCounts.push(stargazers.length);

    console.log(`📊 ${repo} 选择的显示单位: ${unit}`);
    console.log(`📊 ${repo} 总星标数: ${stargazers.length}`);

    // 配置图表 (这部分与之前相同)
    const width = 800;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

    const configuration = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: `${repo} Stars`,
          data: starCounts,
          borderColor: 'rgba(75, 192, 192, 1)',
          fill: true,
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.3,
        }],
      },
      options: {
        scales: {
          y: {
            min: 0, // 强制 Y 轴从 0 开始
            title: {
              display: true,
              text: 'Star 数量',
              font: { size: 14 },
            },
            ticks: { font: { size: 12 } },
          },
          x: {
            title: {
              display: true,
              text: unit === 'day' ? '日期' : unit === 'week' ? '周' : unit === 'month' ? '月份' : '年份',
              font: { size: 14 },
            },
            ticks: {
              font: { size: 12 },
              maxRotation: 45,
              minRotation: 45,
            },
          },
        },
        plugins: {
          legend: {
            labels: {
              font: { size: 14 },
            },
          },
          datalabels: {
            display: true,
            align: 'top',
            color: '#666',
            font: { size: 12 },
            formatter: (value) => value,
          },
        },
      },
      plugins: [ChartDataLabels],
    };

    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    const repoName = repo.split('/')[1].toLowerCase();
    const filePath = path.join('images', `${repoName}_star_chart.png`);
    await fs.writeFile(filePath, imageBuffer);
    console.log(`✅ ${repo} 图表生成成功: ${filePath}`);
    return { repo, filePath };
  } catch (err) {
    console.error(`❌ 生成 ${repo} 图表时发生严重错误，已跳过:`, err.message);
    return null;
  }
}

// 主函数：为所有指定项目生成图表
async function generateAllCharts() {
  const repos = parseRepoUrls();
  if (repos.length === 0) {
    console.error('❌ 没有有效项目，无法生成图表');
    return;
  }

  // 确保 images 目录存在
  try {
    await fs.mkdir('images', { recursive: true });
    console.log('📁 images 目录已准备就绪');
  } catch (err) {
    console.error('❌ 创建 images 目录失败:', err.message);
  }

  // 为每个项目生成图表
  const results = [];
  for (const repo of repos) {
    console.log(`\n🚀 开始处理 ${repo}`);
    const result = await generateChartForRepo(repo);
    if (result) results.push(result);
  }

  // 更新 README.md
  let readmeContent = `# Star Charts\n\nA collection of star history charts for my GitHub projects, automatically updated daily.\n\n## Projects\n\n`;
  for (const { repo, filePath } of results) {
    const repoName = repo.split('/')[1];
    readmeContent += `### ${repoName}\n[![${repoName} Star Chart](${filePath})](https://github.com/${repo})\n\n`;
  }
  readmeContent += `## License\nThis project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.\n\nIf you fork, modify, or redistribute this project, please include a reference to the original repository:  \nhttps://github.com/iawooo/StarCharts\n`;
  try {
    await fs.writeFile('README.md', readmeContent);
    console.log('\n✅ README.md 已更新');
  } catch (err) {
    console.error('❌ 更新 README.md 失败:', err.message);
  }
}

// 运行脚本
generateAllCharts().catch(err => {
  console.error('❌ 脚本执行过程中发生未捕获的顶级错误:', err.message);
  process.exit(1);
});
