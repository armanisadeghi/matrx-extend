import{ht as e,kt as t}from"./preload-helper-BS7-PSjQ.js";import{Za as n,kr as r}from"./globals-CkYqf0Y5.js";import{c as i}from"./CredentialCaptureCard-68-r9jED.js";import{t as a}from"./plus-Df3rQI8_.js";import{t as o}from"./workflow-DIaoohM3.js";var s=n(),c=t(e(),1),l=`
  @keyframes pulseWave {
    0% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
    100% { opacity: 0.3; transform: scale(0.8); }
  }
  
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }
  
  @keyframes neuronPulse {
    0% { transform: scale(0.8); opacity: 0.3; }
    40% { transform: scale(1.4); opacity: 1; }
    80% { transform: scale(0.8); opacity: 0.3; }
    100% { transform: scale(0.8); opacity: 0.3; }
  }
  
  @keyframes brainWavePulse {
    0% { transform: scale(0.8); opacity: 0; }
    20% { opacity: 0.2; }
    50% { transform: scale(1.5); opacity: 0; }
    100% { transform: scale(1.8); opacity: 0; }
  }
  
  .loading-pulse-1 { animation: pulseWave 1.5s infinite ease-in-out; animation-delay: 0s; }
  .loading-pulse-2 { animation: pulseWave 1.5s infinite ease-in-out; animation-delay: 0.3s; }
  .loading-pulse-3 { animation: pulseWave 1.5s infinite ease-in-out; animation-delay: 0.6s; }
  
  .loading-bounce-1 { animation: bounce 1s infinite ease-in-out; animation-delay: 0s; }
  .loading-bounce-2 { animation: bounce 1s infinite ease-in-out; animation-delay: 0.2s; }
  .loading-bounce-3 { animation: bounce 1s infinite ease-in-out; animation-delay: 0.4s; }
  .loading-bounce-4 { animation: bounce 1s infinite ease-in-out; animation-delay: 0.6s; }
  
  .loading-neuron-1 { animation: neuronPulse 2s infinite ease-in-out; animation-delay: 0s; }
  .loading-neuron-2 { animation: neuronPulse 2s infinite ease-in-out; animation-delay: 0.4s; }
  .loading-neuron-3 { animation: neuronPulse 2s infinite ease-in-out; animation-delay: 0.8s; }
  .loading-neuron-4 { animation: neuronPulse 2s infinite ease-in-out; animation-delay: 1.2s; }
  .loading-neuron-5 { animation: neuronPulse 2s infinite ease-in-out; animation-delay: 1.6s; }
  
  .loading-brain-pulse-1 { animation: brainWavePulse 2s infinite ease-in-out; animation-delay: 0s; }
  .loading-brain-pulse-2 { animation: brainWavePulse 2s infinite ease-in-out; animation-delay: 0.5s; }
`,u=({variant:e=`dots`,size:t=`md`,message:n,className:u=``,showMessage:d=!0,fullscreen:f=!1,overlay:p=!1,title:m,subtitle:h,showFeatureIndicators:g=!1,showProgressSteps:_=!0})=>{c.useEffect(()=>{let e=`loading-spinner-styles`;if(!document.getElementById(e)){let t=document.createElement(`style`);t.id=e,t.textContent=l,document.head.appendChild(t)}},[]);let v=(()=>{switch(t){case`sm`:return{container:`gap-2`,dot:`w-1.5 h-1.5`,bar:`w-0.5 h-2`,text:`text-xs`};case`lg`:return{container:`gap-4`,dot:`w-2.5 h-2.5`,bar:`w-1.5 h-4`,text:`text-base`};default:return{container:`gap-3`,dot:`w-2 h-2`,bar:`w-1 h-2.5`,text:`text-sm`}}})(),y=()=>(0,s.jsxs)(`div`,{className:r(`flex items-center`,v.container),children:[(0,s.jsx)(`div`,{className:r(v.dot,`bg-primary dark:bg-primary-foreground rounded-full loading-pulse-1`)}),(0,s.jsx)(`div`,{className:r(v.dot,`bg-primary dark:bg-primary-foreground rounded-full loading-pulse-2`)}),(0,s.jsx)(`div`,{className:r(v.dot,`bg-primary dark:bg-primary-foreground rounded-full loading-pulse-3`)})]}),b=()=>(0,s.jsxs)(`div`,{className:r(`flex items-center`,v.container),children:[(0,s.jsx)(`div`,{className:r(v.bar,`bg-primary dark:bg-primary-foreground rounded-sm loading-bounce-1`)}),(0,s.jsx)(`div`,{className:r(v.bar,`bg-primary dark:bg-primary-foreground rounded-sm loading-bounce-2`)}),(0,s.jsx)(`div`,{className:r(v.bar,`bg-primary dark:bg-primary-foreground rounded-sm loading-bounce-3`)}),(0,s.jsx)(`div`,{className:r(v.bar,`bg-primary dark:bg-primary-foreground rounded-sm loading-bounce-4`)})]}),x=()=>(0,s.jsxs)(`div`,{className:`relative w-6 h-6 flex items-center justify-center`,children:[(0,s.jsx)(`div`,{className:`absolute`,children:(0,s.jsx)(`svg`,{width:`24`,height:`24`,viewBox:`0 0 24 24`,fill:`none`,className:`w-5 h-5 text-primary dark:text-primary-foreground`,children:(0,s.jsx)(`path`,{d:`M12 4C9.5 4 7.5 5.5 7.5 8C7.5 9 7.5 9.5 7 10.5C6.5 11.5 6 12 6 13.5C6 15.5 7.5 17 9.5 17C10.5 17 11 16.5 12 16.5C13 16.5 13.5 17 14.5 17C16.5 17 18 15.5 18 13.5C18 12 17.5 11.5 17 10.5C16.5 9.5 16.5 9 16.5 8C16.5 5.5 14.5 4 12 4Z`,className:`stroke-current`,fill:`none`,strokeWidth:`1.5`})})}),(0,s.jsxs)(`div`,{className:`absolute inset-0`,children:[(0,s.jsx)(`div`,{className:`absolute w-1 h-1 bg-primary/60 dark:bg-primary-foreground/60 rounded-full left-[8px] top-[10px] loading-neuron-1`}),(0,s.jsx)(`div`,{className:`absolute w-1 h-1 bg-primary/60 dark:bg-primary-foreground/60 rounded-full left-[12px] top-[8px] loading-neuron-2`}),(0,s.jsx)(`div`,{className:`absolute w-1 h-1 bg-primary/60 dark:bg-primary-foreground/60 rounded-full left-[16px] top-[10px] loading-neuron-3`}),(0,s.jsx)(`div`,{className:`absolute w-1 h-1 bg-primary/60 dark:bg-primary-foreground/60 rounded-full left-[10px] top-[14px] loading-neuron-4`}),(0,s.jsx)(`div`,{className:`absolute w-1 h-1 bg-primary/60 dark:bg-primary-foreground/60 rounded-full left-[14px] top-[14px] loading-neuron-5`})]}),(0,s.jsx)(`div`,{className:`absolute w-full h-full rounded-full border border-primary/30 dark:border-primary-foreground/30 loading-brain-pulse-1`}),(0,s.jsx)(`div`,{className:`absolute w-full h-full rounded-full border border-primary/30 dark:border-primary-foreground/30 loading-brain-pulse-2`})]}),S=()=>(0,s.jsx)(`div`,{className:`relative`,children:(0,s.jsx)(`div`,{className:r(v.dot,`bg-primary dark:bg-primary-foreground rounded-full loading-pulse-1`)})}),C=()=>(0,s.jsxs)(`div`,{className:`flex flex-col items-center justify-center space-y-6`,children:[(0,s.jsxs)(`div`,{className:`relative`,children:[(0,s.jsx)(`div`,{className:`w-16 h-16 bg-primary/10 dark:bg-primary-foreground/10 rounded-full flex items-center justify-center`,children:(0,s.jsx)(o,{className:`w-8 h-8 text-primary dark:text-primary-foreground`})}),(0,s.jsx)(`div`,{className:`absolute -top-1 -right-1 w-6 h-6 bg-primary dark:bg-primary-foreground rounded-full flex items-center justify-center`,children:(0,s.jsx)(a,{className:`w-3 h-3 text-primary-foreground dark:text-primary`})}),(0,s.jsx)(`div`,{className:`absolute inset-0 border-2 border-transparent border-t-primary dark:border-t-primary-foreground rounded-full animate-spin`})]}),(0,s.jsxs)(`div`,{className:`text-center space-y-2`,children:[(0,s.jsxs)(`h2`,{className:`text-lg font-semibold text-foreground flex items-center gap-2 justify-center`,children:[(0,s.jsx)(i,{className:`w-4 h-4 animate-spin`}),m||`Loading Workflow`]}),(0,s.jsx)(`p`,{className:`type-body text-muted-foreground max-w-sm`,children:h||n||`Setting up your workflow...`})]}),_&&(0,s.jsxs)(`div`,{className:`flex items-center gap-2 type-secondary text-muted-foreground`,children:[(0,s.jsxs)(`div`,{className:`flex items-center gap-1`,children:[(0,s.jsx)(`div`,{className:`w-2 h-2 bg-primary dark:bg-primary-foreground rounded-full animate-pulse`}),(0,s.jsx)(`span`,{children:`Loading`})]}),(0,s.jsx)(`div`,{className:`w-4 h-px bg-muted-foreground/30`}),(0,s.jsxs)(`div`,{className:`flex items-center gap-1 opacity-50`,children:[(0,s.jsx)(`div`,{className:`w-2 h-2 bg-muted-foreground/30 rounded-full`}),(0,s.jsx)(`span`,{children:`Initializing`})]}),(0,s.jsx)(`div`,{className:`w-4 h-px bg-muted-foreground/30`}),(0,s.jsxs)(`div`,{className:`flex items-center gap-1 opacity-30`,children:[(0,s.jsx)(`div`,{className:`w-2 h-2 bg-muted-foreground/30 rounded-full`}),(0,s.jsx)(`span`,{children:`Ready`})]})]})]});return e===`workflow`&&(f||p)?(0,s.jsxs)(`div`,{className:r(`flex items-center justify-center bg-background`,f&&`h-dvh w-full`,u),children:[p&&(0,s.jsx)(`div`,{className:`absolute inset-0 bg-background/80 backdrop-blur-sm z-50`}),(0,s.jsx)(`div`,{className:r(`flex flex-col items-center justify-center`,p&&`relative z-50`),children:C()})]}):(0,s.jsx)(`div`,{className:r(`flex items-center`,u),children:e===`workflow`?C():(0,s.jsxs)(s.Fragment,{children:[(()=>{switch(e){case`bars`:return b();case`brain`:return x();case`minimal`:return S();case`workflow`:return C();default:return y()}})(),d&&(0,s.jsx)(`span`,{className:r(`ml-3 text-muted-foreground`,v.text),children:n||(()=>{switch(e){case`brain`:return`Processing...`;case`workflow`:return`Loading workflows...`;default:return`Loading...`}})()})]})})};function d(){return(0,s.jsx)(u,{variant:`dots`,message:`Initializing Matrx...`,size:`md`})}export{d as t};
//# sourceMappingURL=MatrxMiniLoader-CvyF8QfB.js.map