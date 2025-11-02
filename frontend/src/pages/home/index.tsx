import { Button, Divider, Input } from 'antd';
import { useEffect, useState } from 'react';
import { web3, easyBetContract } from "../../utils/contracts";
import { TransactionReceipt } from 'web3-core';
import { AbiItem } from 'web3-utils';
import logo from './logo.png'; // 把 logo.png 放到 src/pages/lottery/logo.png

import './index.css';

/*
  简化后的页面：只保留 EasyBet 合约相关操作入口（每个合约函数对应一个按钮/表单）
  - 请确保 utils/contracts 导出 easyBetContract 与 web3
  - 所有金额输入以 ether 为单位，前端会转换为 wei
*/

const GanacheTestChainId = '0x539'; // 如需切换网络可改为你的 chainId
const GanacheTestChainRpcUrl = 'http://127.0.0.1:8545';

const LotteryPage = () => {
    const [account, setAccount] = useState<string>('');
    const [status, setStatus] = useState<string>('');

    // 创建活动
    const [choicesCsv, setChoicesCsv] = useState<string>('TeamA,TeamB');
    const [deadlineMinutes, setDeadlineMinutes] = useState<number>(60);
    const [initialPoolEth, setInitialPoolEth] = useState<string>('0.1');
    const [createdActivityId, setCreatedActivityId] = useState<number | null>(null);

    // 追加资金（单独状态，不与 initialPoolEth 共用）
    const [fundAmountEth, setFundAmountEth] = useState<string>('0.1');

    // 下注
    const [buyActivityId, setBuyActivityId] = useState<string>('');
    const [buyChoiceIndex, setBuyChoiceIndex] = useState<string>('0');
    const [buyAmountEth, setBuyAmountEth] = useState<string>('0.01');

    // 二级市场
    const [listTokenId, setListTokenId] = useState<string>('');
    const [listPriceEth, setListPriceEth] = useState<string>('0.02');
    const [cancelTokenId, setCancelTokenId] = useState<string>('');
    const [buyListedTokenId, setBuyListedTokenId] = useState<string>('');

    // 结算
    const [settleActivityId, setSettleActivityId] = useState<string>('');
    const [winningChoiceIndex, setWinningChoiceIndex] = useState<string>('0');

    // 查询
    const [queryActivityId, setQueryActivityId] = useState<string>('');
    const [activityInfo, setActivityInfo] = useState<any>(null);
    const [queryTokenId, setQueryTokenId] = useState<string>('');
    const [ticketInfo, setTicketInfo] = useState<any>(null);
    const [queryListingTokenId, setQueryListingTokenId] = useState<string>('');
    const [listingInfo, setListingInfo] = useState<any>(null);

    useEffect(() => {
        // 页面加载后尝试读取已连接账户
        const init = async () => {
            // @ts-ignore
            const { ethereum } = window;
            if (ethereum && ethereum.isMetaMask) {
                try {
                    const accounts = await web3.eth.getAccounts();
                    if (accounts && accounts.length) setAccount(accounts[0]);
                } catch (e: any) {
                    console.error(e);
                }
            } else {
                setStatus('MetaMask not detected');
            }
        };
        init();

        // 修复页面顶部被遮挡的问题：
        // 1) 清除 body 默认 margin，避免浏览器默认间距导致布局异常
        // 2) 确保 html/body 的高度与滚动行为正常
        try {
            document.body.style.margin = '0';
            document.documentElement.style.height = '100%';
            document.body.style.minHeight = '100vh';
        } catch (e) {
            // ignore server-side rendering environments
        }
    }, []);

    // 连接钱包（并尝试切换到本地链）
    const connectWallet = async () => {
        // @ts-ignore
        const { ethereum } = window;
        if (!ethereum || !ethereum.isMetaMask) {
            alert('Please install MetaMask');
            return;
        }
        try {
            if (ethereum.chainId !== GanacheTestChainId) {
                try {
                    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: GanacheTestChainId }] });
                } catch (switchError: any) {
                    if (switchError.code === 4902) {
                        await ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{ chainId: GanacheTestChainId, chainName: 'Ganache Test Chain', rpcUrls: [GanacheTestChainRpcUrl] }]
                        });
                    }
                }
            }
            await ethereum.request({ method: 'eth_requestAccounts' });
            const accounts = await ethereum.request({ method: 'eth_accounts' });
            setAccount(accounts[0]);
            setStatus('Wallet connected: ' + accounts[0]);
        } catch (err: any) {
            alert(err.message || String(err));
        }
    };

    // ========== EasyBet 合约交互函数（按合约功能组织） ==========

    // 创建活动（owner 调用），choicesCsv: "A,B,C"；deadlineMinutes：与当前时间加多少分钟；initialPoolEth 为 ETH
    const createActivity = async () => {

        const abi = easyBetContract.options.jsonInterface as AbiItem[];

        console.log(
            abi
                .map((f: AbiItem) => f.name) // 指定 f 类型
                .filter((name): name is string => !!name) // 过滤掉 undefined
        );

        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const choices = choicesCsv.split(',').map(s => s.trim()).filter(s => s.length);
            const deadline = Math.floor(Date.now() / 1000) + Number(deadlineMinutes) * 60;
            const value = web3.utils.toWei(initialPoolEth, 'ether');
            const receipt: TransactionReceipt = await easyBetContract.methods
                .createActivity(choices, deadline)
                .send({ from: account, value })
                .on('receipt', (r: TransactionReceipt) => {
                    console.log('Receipt from callback:', r);
                })
                .on('error', (e: Error) => {
                    console.error('Transaction error:', e);
                });

            // 优先从事件读取 activityId；若事件不可用则调用合约视图获取最新 activityId
            let id: string | number | null = null;

            if (receipt && receipt.events && receipt.events.ActivityCreated && receipt.events.ActivityCreated.returnValues) {
                const rv = receipt.events.ActivityCreated.returnValues;

                // 尝试从命名键读取
                if (rv.activityId !== undefined) {
                    id = rv.activityId;
                } else {
                    // fallback: indexed 参数可能在数组索引里
                    id = rv[0];
                }
            }
            setCreatedActivityId(Number(id));
            setStatus('Activity created id: ' + id);
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 向已有活动追加资金（owner 调用）
    const fundActivity = async (activityId: string, ethAmount: string) => {
        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const value = web3.utils.toWei(ethAmount, 'ether');
            await easyBetContract.methods.fundActivity(Number(activityId)).send({ from: account, value });
            setStatus('Funded activity ' + activityId);
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 买票（下注并铸造 ERC721 票据），value 为 ETH
    const buyTicket = async () => {
        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const value = web3.utils.toWei(buyAmountEth, 'ether');
            const tx = await easyBetContract.methods.buyTicket(Number(buyActivityId), Number(buyChoiceIndex)).send({ from: account, value });
            setStatus('Ticket bought tx: ' + tx.transactionHash);
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 上架票据（先 approve 本合约，再调用 listTicket）
    const listTicket = async () => {
        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const tokenId = Number(listTokenId);
            const contractAddress = easyBetContract.options.address;
            // owner 调用 approve（ERC721 自带）
            await easyBetContract.methods.approve(contractAddress, tokenId).send({ from: account });
            await easyBetContract.methods.listTicket(tokenId, web3.utils.toWei(listPriceEth, 'ether')).send({ from: account });
            setStatus('Ticket listed: ' + tokenId);
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 取消挂单
    const cancelListing = async () => {
        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            await easyBetContract.methods.cancelListing(Number(cancelTokenId)).send({ from: account });
            setStatus('Listing canceled: ' + cancelTokenId);
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 购买挂单票据（需要发送 exact price）
    const buyListedTicket = async () => {
        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const l = await easyBetContract.methods.getListing(Number(buyListedTokenId)).call();
            if (!l || !l.exists) { alert('No listing'); return; }
            const price = l.price;
            await easyBetContract.methods.buyListedTicket(Number(buyListedTokenId)).send({ from: account, value: price });
            setStatus('Bought listed ticket ' + buyListedTokenId);
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 结算活动（owner 调用）
    const settleActivity = async () => {
        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            await easyBetContract.methods.settleActivity(Number(settleActivityId), Number(winningChoiceIndex)).send({ from: account });
            setStatus('Activity settled: ' + settleActivityId);
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 查询活动（选择数量 + 活动票据 id 列表）
    const getActivityInfo = async () => {
        if (!queryActivityId) { alert('请输入活动 id'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const exists = await easyBetContract.methods.activityExists(Number(queryActivityId)).call();
            if (!exists) { alert('Activity not exists'); return; }
            const choicesCount = await easyBetContract.methods.getChoicesCount(Number(queryActivityId)).call();
            const ticketIds = await easyBetContract.methods.getActivityTicketIds(Number(queryActivityId)).call();
            setActivityInfo({ choicesCount: Number(choicesCount), ticketIds });
            setStatus('Fetched activity info');
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 查询票据信息（activityId, choiceIndex, amount）
    const getTicketInfo = async () => {
        if (!queryTokenId) { alert('请输入 ticket id'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const info = await easyBetContract.methods.getTicketInfo(Number(queryTokenId)).call();
            setTicketInfo(info);
            setStatus('Fetched ticket info');
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 查询挂单信息
    const getListing = async () => {
        if (!queryListingTokenId) { alert('请输入 token id'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const l = await easyBetContract.methods.getListing(Number(queryListingTokenId)).call();
            setListingInfo(l);
            setStatus('Fetched listing info');
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // Owner 提取合约余额（示例）
    const withdraw = async (amountEth: string) => {
        if (!account) { alert('请先连接钱包'); return; }
        if (!easyBetContract) { alert('Contract not available'); return; }
        try {
            const wei = web3.utils.toWei(amountEth, 'ether');
            await easyBetContract.methods.withdraw(wei).send({ from: account });
            setStatus('Withdraw done');
        } catch (e: any) {
            alert(e.message || String(e));
        }
    };

    // 简单的页面布局，仅包含 EasyBet 功能入口
    return (
        // 使用 .container CSS 类管理布局与顶部对齐（避免被父级 flex 居中）
        <div className="container">
            <div className="header">
                <img src={logo} alt="logo" className="logo" />
                <div className="title">EasyBet</div>
            </div>

            <div>当前账户: {account || '未连接'}</div>
            <div style={{ marginTop: 8 }}>
                <Button onClick={connectWallet}>连接钱包</Button>
            </div>

            <Divider>创建活动（createActivity）</Divider>
            <div>
                <div>选项 (逗号分隔)：</div>
                <Input value={choicesCsv} onChange={e => setChoicesCsv(e.target.value)} style={{ width: 400 }} />
                <div style={{ marginTop: 8 }}>截止时间（分钟后）：</div>
                <Input value={deadlineMinutes} onChange={e => setDeadlineMinutes(Number(e.target.value))} style={{ width: 200 }} />
                <div style={{ marginTop: 8 }}>初始奖池 (ETH)：</div>
                <Input value={initialPoolEth} onChange={e => setInitialPoolEth(e.target.value)} style={{ width: 200 }} />
                <div style={{ marginTop: 8 }}>
                    <Button onClick={createActivity}>创建活动</Button>
                    <span style={{ marginLeft: 12 }}>创建返回活动ID: {createdActivityId ?? '-'}</span>
                </div>
            </div>

            <Divider>追加资金 (fundActivity)</Divider>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <Input placeholder="activityId" onChange={e => setQueryActivityId(e.target.value)} style={{ width: 200 }} />
                <Input placeholder="追加金额 ETH" value={fundAmountEth} onChange={e => setFundAmountEth(e.target.value)} style={{ width: 200, marginLeft: 8 }} />
                <Button onClick={() => fundActivity(queryActivityId, fundAmountEth)} style={{ marginLeft: 8 }}>追加资金</Button>
            </div>

            <Divider>下注 (buyTicket)</Divider>
            <div>
                <Input placeholder="activityId" onChange={e => setBuyActivityId(e.target.value)} style={{ width: 200 }} />
                <Input placeholder="choiceIndex" onChange={e => setBuyChoiceIndex(e.target.value)} style={{ width: 200, marginLeft: 8 }} />
                <Input placeholder="金额 ETH" value={buyAmountEth} onChange={e => setBuyAmountEth(e.target.value)} style={{ width: 200, marginLeft: 8 }} />
                <Button onClick={buyTicket} style={{ marginLeft: 8 }}>下注并铸票</Button>
            </div>

            <Divider>二级市场（list / cancel / buy）</Divider>
            <div>
                <div>
                    <Input placeholder="tokenId to list" onChange={e => setListTokenId(e.target.value)} style={{ width: 200 }} />
                    <Input placeholder="price ETH" value={listPriceEth} onChange={e => setListPriceEth(e.target.value)} style={{ width: 200, marginLeft: 8 }} />
                    <Button onClick={listTicket} style={{ marginLeft: 8 }}>Approve & List</Button>
                </div>

                <div style={{ marginTop: 8 }}>
                    <Input placeholder="tokenId cancel" onChange={e => setCancelTokenId(e.target.value)} style={{ width: 200 }} />
                    <Button onClick={cancelListing} style={{ marginLeft: 8 }}>取消挂单</Button>
                </div>

                <div style={{ marginTop: 8 }}>
                    <Input placeholder="tokenId buy" onChange={e => setBuyListedTokenId(e.target.value)} style={{ width: 200 }} />
                    <Button onClick={buyListedTicket} style={{ marginLeft: 8 }}>购买挂单票据</Button>
                </div>
            </div>

            <Divider>结算 (settleActivity)</Divider>
            <div>
                <Input placeholder="activityId" onChange={e => setSettleActivityId(e.target.value)} style={{ width: 200 }} />
                <Input placeholder="winningChoiceIndex" onChange={e => setWinningChoiceIndex(e.target.value)} style={{ width: 200, marginLeft: 8 }} />
                <Button onClick={settleActivity} style={{ marginLeft: 8 }}>结算活动</Button>
            </div>

            <Divider>查询 (activity / ticket / listing)</Divider>
            <div>
                <div>
                    <Input placeholder="activityId" onChange={e => setQueryActivityId(e.target.value)} style={{ width: 200 }} />
                    <Button onClick={getActivityInfo} style={{ marginLeft: 8 }}>查询活动信息</Button>
                </div>
                <div style={{ marginTop: 8 }}>activityInfo: {activityInfo ? JSON.stringify(activityInfo) : '-'}</div>

                <div style={{ marginTop: 12 }}>
                    <Input placeholder="ticketId" onChange={e => setQueryTokenId(e.target.value)} style={{ width: 200 }} />
                    <Button onClick={getTicketInfo} style={{ marginLeft: 8 }}>查询票据信息</Button>
                </div>
                <div style={{ marginTop: 8 }}>ticketInfo: {ticketInfo ? JSON.stringify(ticketInfo) : '-'}</div>

                <div style={{ marginTop: 12 }}>
                    <Input placeholder="listing tokenId" onChange={e => setQueryListingTokenId(e.target.value)} style={{ width: 200 }} />
                    <Button onClick={getListing} style={{ marginLeft: 8 }}>查询挂单</Button>
                </div>
                <div style={{ marginTop: 8 }}>listingInfo: {listingInfo ? JSON.stringify(listingInfo) : '-'}</div>
            </div>

            <Divider>其他 (withdraw)</Divider>
            <div>
                <Input placeholder="withdraw amount ETH" onChange={e => setInitialPoolEth(e.target.value)} style={{ width: 200 }} />
                <Button onClick={() => withdraw(initialPoolEth)} style={{ marginLeft: 8 }}>提取合约资金（owner）</Button>
            </div>

            <Divider>状态</Divider>
            <div>{status}</div>
        </div>
    );
};

export default LotteryPage;