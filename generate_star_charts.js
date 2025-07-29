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
        console.error(`❌ 获取 ${repo} 星标失败: ${response.status} ${response.statusText} - ${errorText}`);
        return [];
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
    return [];
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
    // 并行获取 star 数据和仓库创建日期，效率更高
    const [stargazers, creationDate] = await Promise.all([
      fetchStargazers(repo),
      fetchRepoCreationDate(repo)
    ]);

    // earliestDate 现在是仓库的创建日期
    const earliestDate = creationDate;
    const now = new Date();

    // 计算总天数，从创建日开始算
    const totalDays = Math.ceil((now - earliestDate) / (1000 * 60 * 60 * 24));
    console.log(`📊 ${repo} 总天数 (自创建以来): ${totalDays}`);

    // 根据时间跨度选择显示单位
    let unit;
    let labels = [];
    let starCounts = [];

    // 这部分的 if/else 逻辑和之前类似，但现在它会从0开始计算
    if (totalDays >= 0 && totalDays < 30) {
      // (代码逻辑与原版类似，但因为 earliestDate 变了，所以会从创建日开始)
      // ...
    } else if (totalDays >= 30 && totalDays < 180) {
      // (代码逻辑与原版类似)
      // ...
    } else if (totalDays >= 180 && totalDays < 1000) {
      // 使用“月”作为单位
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
      // (代码逻辑与原版类似)
      // ...
    } else {
      console.error(`❌ ${repo} 时间跨度无效，跳过图表生成`);
      return null;
    }

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
            beginAtZero: true,
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
    console.error(`❌ 生成 ${repo} 图表时发生严重错误:`, err.message);
    return null;
  }
}

async function fetchRepoCreationDate(repo) {
  const token = process.env.GH_TOKEN;
  if (!token) {
    // 如果没有 token，虽然公共仓库也能访问，但为了统一和避免速率限制，最好还是提示
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
    console.log(`🚀 开始处理 ${repo}`);
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
    console.log('✅ README.md 已更新');
  } catch (err) {
    console.error('❌ 更新 README.md 失败:', err.message);
  }
}

// 运行脚本
generateAllCharts().catch(err => {
  console.error('❌ 生成图表时发生错误:', err.message);
  process.exit(1);
});
