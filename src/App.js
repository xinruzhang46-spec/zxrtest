import { useEffect, useRef,useState } from 'react';
import * as zrender from 'zrender';
import { Circle, Rect, Text,Polyline } from 'zrender';
import './App.css';
import waveBoothData from './data/waveData';

function App() {
  const canvasRef = useRef();
  const zrRef = useRef(null); // 保存zrender实例
  const [allSmoothPoints, setAllSmoothPoints] = useState([]);//实际绘制点
  const drawTimerRef = useRef(null); // 绘制定时器
  const progressCircleRef = useRef(null); // 进度圆点实例
  const [isDrawing, setIsDrawing] = useState(false); // 是否正在绘制状态
  const [isStop, setIsStop] = useState(false); // 是否暂停
  const drawRateRef = useRef(0.004)// 绘制进度 0-1
  const [drawProgress, setDrawProgress] = useState(0); // 绘制进度 0-1
  const AMPLIFY_RATIO = 2;//起伏放大系数
  const POINT_DENSITY = 10;  // 补点密度：每个原始点之间补5个中间点，值越大越平滑
  const baseLine = 128; // 波形基线值（0-255范围的中点）
  const [allOriginWaveValues, setAllOriginWaveValues] = useState([]) //原始波形值(包括追加后)
  const latestSmoothPointsRef = useRef([]);//最新一次绘制的点
  const canvasWidth = 800;
  const canvasHeight = 400;
  const changeSpeed=0.001 // 调整速度
  const appendPointNum = 20; // 每次追加的点数，固定20个
  const drawnPointCountRef = useRef(0);//已经绘制的点数


// Catmull-Rom 插值补点函数（生成高密度平滑点）
  function smoothWavePoints(points, density) {
    const smoothPoints = [];
    // 遍历原始点，对每一段折线进行插值
    for (let i=0; i < points.length-1; i++) {
      const p0=points[Math.max(i-1, 0)]; // 前一个点（边界处理）
      const p1=points[i];                   // 当前点
      const p2=points[i+1];               // 下一个点
      const p3=points[Math.min(i+2, points.length-1)]; // 后一个点（边界处理）

      // 按密度生成中间点
      for (let t=0; t <= 1; t += 1/density) {
        // Catmull-Rom 插值公式：生成平滑曲线点
        const x=0.5 * (
          -t*(1-t)*(1-t)*p0[0] +
          (2-5*t*t+3*t*t*t)*p1[0] +
          (t+4*t*t-3*t*t*t)*p2[0] +
          -t*t*(1-t)*p3[0]
        );
        const y=0.5 * (
          -t*(1-t)*(1-t)*p0[1] +
          (2-5*t*t+3*t*t*t)*p1[1] +
          (t+4*t*t-3*t*t*t)*p2[1] +
          -t*t*(1-t)*p3[1]
        );
        smoothPoints.push([x, y]);
      }
    }
    return smoothPoints;
  }

   const transToWavePoints = (values) => {
    const pointCount = values.length;
    const xStep = canvasWidth / pointCount; // 固定步长，和原始波形一致
    return values.map((value, index) => {
      const xRatio = index / (pointCount - 1);
      const x = xRatio * canvasWidth;
      const diff = value - baseLine;
      const amplifiedDiff = diff * AMPLIFY_RATIO;
      const y = (canvasHeight / 2) - amplifiedDiff;
      return [x, y];
    });
  };



  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    
    const dpr = window.devicePixelRatio || 1
    console.log('dpr',dpr)
    // 高分屏：物理像素乘 dpr，样式保持逻辑尺寸
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    const zr = zrender.init(canvasRef.current,{devicePixelRatio:dpr, width: canvasWidth, height: canvasHeight});
    zrRef.current = zr;
    zr.clear();

    const { sampleRate, waveData } = waveBoothData;
    setAllOriginWaveValues(waveData);
    const wavePoints = transToWavePoints(waveData);
    const smoothPoints=smoothWavePoints(wavePoints, POINT_DENSITY);
    setAllSmoothPoints(smoothPoints);
    latestSmoothPointsRef.current = smoothPoints;
     const baseLineShape = new Polyline({
      shape: {
        points: [[0, canvasHeight/2], [canvasWidth, canvasHeight/2]]
      },
      style: { stroke: '#999', lineWidth: 1 }
    });

    zr.add(baseLineShape);
   
    return () => {
      zr.clear();
      zr.dispose();
    };
  }, []); 
  useEffect(()=>{
    if (allSmoothPoints.length === 0) return;
     const wavePoints = transToWavePoints(allOriginWaveValues);
    const smoothPoints=smoothWavePoints(wavePoints, POINT_DENSITY);
    setAllSmoothPoints(smoothPoints);
    latestSmoothPointsRef.current = smoothPoints;
     const newProgress = drawnPointCountRef.current / smoothPoints.length;
    setDrawProgress(newProgress > 1 ? 1 : newProgress);
  },[allOriginWaveValues])

  // 根据绘制进度，实时渲染【已绘制蓝色波形】+【未绘制浅灰色波形】+【进度圆点】
  useEffect(() => {
    if (!zrRef.current || allSmoothPoints.length === 0 || drawProgress === 0) return;

    const zr = zrRef.current;
    zr.clear(); // 清空画布重绘

    // 1. 绘制基线
    const baseLineShape = new Polyline({
      shape: { points: [[0, canvasHeight / 2], [canvasWidth, canvasHeight / 2]] },
      style: { stroke: '#999', lineWidth: 1 }
    });
    zr.add(baseLineShape);


    // 计算绘制分割点：总点位 * 进度
    const splitIndex = Math.floor(allSmoothPoints.length * drawProgress);
    const drawnPoints = allSmoothPoints.slice(0, splitIndex); // 已绘制的点位
    const undrawnPoints = allSmoothPoints.slice(splitIndex);  // 未绘制的点位

    // 2. 绘制【未绘制区域】- 浅灰色、低透明度、同样式
    if (undrawnPoints.length > 1) {
      const undrawnLine = new Polyline({
        shape: { points: undrawnPoints },
        style: { stroke: '#c9d8f0', lineWidth: 2, opacity: 0.4, lineCap: 'round', lineJoin: 'round' }
      });
      zr.add(undrawnLine);
    }

    // 3. 绘制【已绘制区域】- 原蓝色、高亮、圆润
    if (drawnPoints.length > 1) {
      const drawnLine = new Polyline({
        shape: { points: drawnPoints },
        style: { stroke: '#165DFF', lineWidth: 2, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }
      });
      zr.add(drawnLine);
    }

    // 4. 绘制【进度圆点】- 橙色实心圆、跟随绘制终点
    if (drawnPoints.length > 0) {
      const lastPoint = drawnPoints[drawnPoints.length - 1];
      const progressCircle = new Circle({
        shape: { cx: lastPoint[0], cy: lastPoint[1], r: 5 }, // 半径5的圆点
        style: { fill: '#FF7D00', stroke: '#fff', lineWidth: 1.5 } // 橙色填充+白色描边
      });
      progressCircleRef.current = progressCircle;
      zr.add(progressCircle);
    }

  }, [drawProgress, allSmoothPoints]);

  // 点击开始绘制按钮的事件
  const startDrawWave = (progress) => {
    if (isDrawing) return; // 防止重复点击
    setDrawProgress(progress); // 重置进度
    drawnPointCountRef.current = Math.floor(allSmoothPoints.length * progress);
    setIsDrawing(true);
    setIsStop(false);
    // 开启定时器，逐步增加绘制进度，实现平滑动画
    clearInterval(drawTimerRef.current);
    drawTimerRef.current = setInterval(() => {
      const currentTotalPoints = latestSmoothPointsRef.current.length;
      console.log('currentTotalPoints',currentTotalPoints)
      if (currentTotalPoints === 0) return;
      drawnPointCountRef.current += Math.ceil(currentTotalPoints * drawRateRef.current);
      let newProgress = drawnPointCountRef.current / currentTotalPoints;
      if (newProgress >= 1) {
        clearInterval(drawTimerRef.current);
        setIsDrawing(false);
        newProgress = 1;
        drawnPointCountRef.current = currentTotalPoints;
      }
      setDrawProgress(newProgress);
    }, 16); // 60帧刷新率，保证动画流畅
  };

  const clickStopHandle = () => {
    if(!isStop){
      //暂停绘制
      clearInterval(drawTimerRef.current);
      setIsStop(true);
      setIsDrawing(false);
      
    }else{
      //继续绘制
      startDrawWave(drawProgress);
      setIsStop(false);
      setIsDrawing(true);
    }
  }

  const handleSpeed=(type)=>{
    if(!isDrawing||isStop) return
    if(type==='minus'){
      const tempSpeed=drawRateRef.current-changeSpeed;
      if(tempSpeed<=0) return
      drawRateRef.current=tempSpeed;
    }
    else if(type==='add'){
      const tempSpeed=drawRateRef.current+changeSpeed;
      if(tempSpeed>1) return
      drawRateRef.current=tempSpeed;

    }
  }

  const handleAppendData=()=>{
    const randomAppendPoints = Array(appendPointNum).fill(0).map(() => {
      return Math.floor(baseLine + (Math.random() - 0.5) * 30);
    });
    const newValues=[...allOriginWaveValues,...randomAppendPoints]
    setAllOriginWaveValues(newValues)
  }

  const handelRestData=()=>{
    clearInterval(drawTimerRef.current);
    setAllOriginWaveValues(waveBoothData.waveData);
    setDrawProgress(0);
    drawnPointCountRef.current = 0;
    setIsDrawing(false);
    setIsStop(false);
    if (zrRef.current) {
      zrRef.current.clear();
      //  清空画布后，重新绘制基线
      const baseLineShape = new Polyline({
        shape: { points: [[0, canvasHeight / 2], [canvasWidth, canvasHeight / 2]] },
        style: { stroke: '#999', lineWidth: 1 }
      });
      zrRef.current.add(baseLineShape);
    }
  }

  return (
    <div className="App">
      <h3>波形数据 → ZRender绘制 示例</h3>
      <div>
        <button 
          onClick={()=>startDrawWave(0)}
          disabled={isDrawing}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: isDrawing ? '#ccc' : '#165DFF',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: isDrawing ? 'not-allowed' : 'pointer',
            marginRight: '200px'
            }}
        >
          {isDrawing ? '绘制中...' : '开始绘制波形'}
        </button>
        {drawProgress > 0 && drawProgress < 1&& 
        <button 
            onClick={clickStopHandle}
            style={{
              marginLeft: '10px',
              padding: '8px 16px',
              fontSize: '14px',
              backgroundColor:'#165DFF',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '15px'
            }}
          >
            {isStop ? '继续绘制':'暂停绘制'  }
        </button>}
        <button 
            onClick={()=>handleSpeed('minus')}
            disabled={!isDrawing||drawRateRef.current-changeSpeed<=0}
            style={{
              marginLeft: '10px',
              padding: '8px 16px',
              fontSize: '14px',
              backgroundColor: !isDrawing||drawRateRef.current-changeSpeed<=0 ? '#ccc' : '#165DFF',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '15px',
              cursor: !isDrawing||drawRateRef.current-changeSpeed<=0 ? 'not-allowed' : 'pointer',
            }}
          >
            放慢速度
        </button>
        <button 
            onClick={()=>handleSpeed('add')}
            disabled={!isDrawing||drawRateRef.current+changeSpeed>1}
            style={{
              marginLeft: '10px',
              padding: '8px 16px',
              fontSize: '14px',
              backgroundColor: !isDrawing||drawRateRef.current+changeSpeed>1 ? '#ccc' : '#165DFF',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: !isDrawing||drawRateRef.current+changeSpeed>1 ? 'not-allowed' : 'pointer',
              marginBottom: '15px'
            }}
          >
            加快速度
        </button>
        <button 
            onClick={handleAppendData}
            style={{
              marginLeft: '10px',
              padding: '8px 16px',
              fontSize: '14px',
              backgroundColor:'#165DFF',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '15px'
            }}
          >
            追加数据
        </button>
        <button 
            onClick={handelRestData}
            style={{
              marginLeft: '10px',
              padding: '8px 16px',
              fontSize: '14px',
              backgroundColor:'#165DFF',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '15px'
            }}
          >
            重置
        </button>
      </div>
      
     
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        style={{ border: '1px solid #eee', backgroundColor: '#f9f9f9' }}
      />
    </div>
  );
}

export default App;