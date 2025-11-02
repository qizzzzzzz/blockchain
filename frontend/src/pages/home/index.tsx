import { Button, Divider, Input, message, List, Table, Tag, Checkbox } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import type { Key } from 'react';
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

// 新增：活动详情视图类型
type ActivityDetailView = {
    id: number;
    creator: string;
    deadline: number;
    deadlineText: string;
    choices: string[];
    initialPoolEth: string;
    totalPoolEth: string;
    settled: boolean;
    winningChoice: number;
    choiceBetAmountsEth: string[];
};

const LotteryPage = () => {
    const [account, setAccount] = useState<string>('');
    const [status, setStatus] = useState<string>('');
    // 创建活动
    const [choicesCsv, setChoicesCsv] = useState<string>('TeamA,TeamB');
    const [deadlineMinutes, setDeadlineMinutes] = useState<number>(60);
    const [initialPoolEth, setInitialPoolEth] = useState<string>('0.1');
    const [createdActivityId, setCreatedActivityId] = useState<number | null>(null);

    // 下注
    const [buyActivityId, setBuyActivityId] = useState<string>('');
    const [buyChoiceIndex, setBuyChoiceIndex] = useState<string>('');
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

    // 新增：我的 / 市场 数据
    const [myActivities, setMyActivities] = useState<number[]>([]);
    const [myTickets, setMyTickets] = useState<number[]>([]);
    const [myListings, setMyListings] = useState<{ tokenId: number; price: string }[]>([]);
    const [marketListings, setMarketListings] = useState<{ tokenId: number; seller: string; priceWei: string }[]>([]);
    const [selectedListingOffers, setSelectedListingOffers] = useState<{ bidders: string[]; prices: string[] } | null>(null);
    const [offerTokenId, setOfferTokenId] = useState<string>('');
    const [offerPriceEth, setOfferPriceEth] = useState<string>('0.01');
    const [allActivityDetails, setAllActivityDetails] = useState<ActivityDetailView[]>([]);
    const [showOnlyMyActivities, setShowOnlyMyActivities] = useState<boolean>(false);
    const [activitiesLoading, setActivitiesLoading] = useState<boolean>(false);
    const [betActivityDetail, setBetActivityDetail] = useState<ActivityDetailView | null>(null);
    const [betOptionsLoading, setBetOptionsLoading] = useState<boolean>(false);
    const [settleActivityDetail, setSettleActivityDetail] = useState<ActivityDetailView | null>(null);
    const [settleOptionsLoading, setSettleOptionsLoading] = useState<boolean>(false);
    const activityColumns: ColumnsType<ActivityDetailView> = [
        { title: '活动ID', dataIndex: 'id', key: 'id', width: 90, align: 'center' },
        {
            title: '创建者',
            key: 'creator',
            width: 120,
            align: 'center',
            render: (_: any, record: ActivityDetailView) =>
                account && record.creator.toLowerCase() === account.toLowerCase() ? '我' : '其他',
        },
        { title: '截止时间', dataIndex: 'deadlineText', key: 'deadline', width: 200, align: 'center' },
        {
            title: '选项 & 累计下注 (ETH)',
            key: 'choices',
            align: 'center',
            render: (_: any, record: ActivityDetailView) => (
                <div>
                    {record.choices.map((choice, idx) => (
                        <div key={idx}>{`${choice}：${record.choiceBetAmountsEth[idx] ?? '0'}`}</div>
                    ))}
                </div>
            ),
        },
        {
            title: '获胜选项',
            key: 'winner',
            width: 160,
            align: 'center',
            render: (_: any, record: ActivityDetailView) =>
                record.settled ? (record.choices[record.winningChoice] ?? `索引 ${record.winningChoice}`) : '-',
        },
        {
            title: '奖池金额 (ETH)',
            dataIndex: 'totalPoolEth',
            key: 'totalPoolEth',
            width: 140,
            align: 'center',
        },
        {
            title: '状态',
            key: 'settled',
            width: 120,
            align: 'center',
            render: (_: any, record: ActivityDetailView) =>
                record.settled ? <Tag color="green">已结算</Tag> : <Tag color="blue">进行中</Tag>,
        },
    ];
    const activityTableData = showOnlyMyActivities
        ? allActivityDetails.filter(
            (item) => account && item.creator.toLowerCase() === account.toLowerCase()
        )
        : allActivityDetails;

    const betOptionsData = betActivityDetail
        ? betActivityDetail.choices.map((choice, idx) => ({
            key: idx,
            index: idx + 1,
            name: choice,
            pool: betActivityDetail.choiceBetAmountsEth[idx] ?? '0',
            profit: (() => {
                const poolValue = Number(betActivityDetail.choiceBetAmountsEth[idx] ?? '0');
                const totalPoolValue = Number(betActivityDetail.totalPoolEth ?? '0');
                return poolValue > 0 ? (totalPoolValue / poolValue).toFixed(2) : '暂无';
            })(),
        }))
        : [];
    const betOptionsRowSelection = {
        type: 'radio' as const,
        selectedRowKeys: buyChoiceIndex !== '' ? [Number(buyChoiceIndex)] : [],
        onChange: (selectedRowKeys: Key[]) => {
            const key = selectedRowKeys[0];
            setBuyChoiceIndex(key !== undefined ? String(key) : '');
        },
    };
    const betDisabled = !buyActivityId || buyChoiceIndex === '';
    const betButtonStyle = {
        marginLeft: 8,
        backgroundColor: betDisabled ? '#656565' : '#111111',
        borderColor: betDisabled ? '#656565' : '#111111',
        color: '#ffffff',
    };

    const settleOptionsData = settleActivityDetail
        ? settleActivityDetail.choices.map((choice, idx) => ({
            key: idx,
            index: idx + 1,
            name: choice,
            pool: settleActivityDetail.choiceBetAmountsEth[idx] ?? '0',
        }))
        : [];
    const settleOptionsRowSelection = {
        type: 'radio' as const,
        selectedRowKeys: winningChoiceIndex !== '' ? [Number(winningChoiceIndex)] : [],
        onChange: (selectedRowKeys: Key[]) => {
            const key = selectedRowKeys[0];
            setWinningChoiceIndex(key !== undefined ? String(key) : '');
        },
        columnTitle: '结算选择',
        columnWidth: 140,
    };
    const settleDisabled = !settleActivityId || winningChoiceIndex === '';
    const settleButtonStyle = {
        marginLeft: 8,
        backgroundColor: settleDisabled ? '#ff7875' : '#d32029',
        borderColor: settleDisabled ? '#ff7875' : '#d32029',
        color: '#ffffff',
    };

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
                setStatus('未检测到 MetaMask 或其他钱包扩展。请安装或启用钱包扩展以继续使用本应用。');
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

    useEffect(() => {
        if (!easyBetContract) return;
        const fetchAllActivities = async () => {
            try {
                const ids: string[] = await easyBetContract.methods.getAllActivityIds().call();
                await loadActivityDetails(ids.map((s: any) => Number(s)));
            } catch (e) {
                console.error('initial loadActivityDetails', e);
            }
        };
        fetchAllActivities();
    }, [easyBetContract]);

    // 连接钱包（并尝试切换到本地链）
    const connectWallet = async () => {
        // @ts-ignore
        const { ethereum } = window;
        if (!ethereum || !ethereum.isMetaMask) {
            message.error('未检测到 MetaMask。请安装 MetaMask 或启用兼容的钱包扩展后重试。');
            setStatus('未检测到钱包或 MetaMask');
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

            // 成功连接提示与状态更新
            const acct = accounts && accounts[0] ? accounts[0] : '';
            setAccount(acct);
            setStatus(acct ? '已连接' : '未找到账户');
            if (acct) {
                message.success(`钱包已连接：${acct}`);
            } else {
                message.warning('已连接但未返回账户。请在钱包中解锁并授权本网站后重试。');
            }
        } catch (err: any) {
            // 失败提示与状态更新
            const msg = err && err.message ? err.message : String(err);
            setStatus('连接失败');
            message.error('连接钱包失败：' + msg);
        }
    };

    const loadActivityDetails = async (ids: number[]) => {
        if (!easyBetContract) return;
        if (!ids.length) {
            setAllActivityDetails([]);
            return;
        }
        setActivitiesLoading(true);
        try {
            const detailList = await Promise.all(
                ids.map(async (id) => {
                    const res: any = await easyBetContract.methods.getActivityDetail(id).call();
                    const creator = res[0] as string;
                    const deadline = Number(res[1]);
                    const choices = res[2] as string[];
                    const initialPoolEth = web3.utils.fromWei(res[3], 'ether');
                    const totalPoolEth = web3.utils.fromWei(res[4], 'ether');
                    const settled = Boolean(res[5]);
                    const winningChoice = Number(res[6]);
                    const choiceBetAmountsEth = (res[7] as string[]).map((v) =>
                        web3.utils.fromWei(v, 'ether')
                    );
                    return {
                        id,
                        creator,
                        deadline,
                        deadlineText: new Date(deadline * 1000).toLocaleString(),
                        choices,
                        initialPoolEth,
                        totalPoolEth,
                        settled,
                        winningChoice,
                        choiceBetAmountsEth,
                    } as ActivityDetailView;
                })
            );
            setAllActivityDetails(detailList);
        } catch (error) {
            console.error('loadActivityDetails', error);
        } finally {
            setActivitiesLoading(false);
        }
    };

    const fetchBetActivityDetail = async (id: number) => {
        if (!easyBetContract) return;
        setBetOptionsLoading(true);
        try {
            const exists = await easyBetContract.methods.activityExists(id).call();
            if (!exists) {
                message.warning('活动不存在或已被移除');
                setBetActivityDetail(null);
                return;
            }
            const res: any = await easyBetContract.methods.getActivityDetail(id).call();
            const creator = res[0] as string;
            const deadline = Number(res[1]);
            const choices = res[2] as string[];
            const initialPoolEth = web3.utils.fromWei(res[3], 'ether');
            const totalPoolEth = web3.utils.fromWei(res[4], 'ether');
            const settled = Boolean(res[5]);
            const winningChoice = Number(res[6]);
            const choiceBetAmountsEth = (res[7] as string[]).map((v) => web3.utils.fromWei(v, 'ether'));
            const now = Math.floor(Date.now() / 1000);
            if (settled) {
                message.warning('该活动已结算，无法继续下注');
                setBetActivityDetail(null);
                return;
            }
            if (deadline <= now) {
                message.warning('该活动已超过截止时间，无法继续下注');
                setBetActivityDetail(null);
                return;
            }
            const detail: ActivityDetailView = {
                id,
                creator,
                deadline,
                deadlineText: new Date(deadline * 1000).toLocaleString(),
                choices,
                initialPoolEth,
                totalPoolEth,
                settled,
                winningChoice,
                choiceBetAmountsEth,
            };
            setBetActivityDetail(detail);
            setBuyChoiceIndex((prev) => {
                if (!detail.choices.length) return '';
                const prevIndex = Number(prev);
                if (!Number.isNaN(prevIndex) && prevIndex >= 0 && prevIndex < detail.choices.length) {
                    return String(prevIndex);
                }
                return '0';
            });
        } catch (error: any) {
            console.error('fetchBetActivityDetail', error);
            message.error(error?.message || '加载活动详情失败');
            setBetActivityDetail(null);
        } finally {
            setBetOptionsLoading(false);
        }
    };

    const fetchSettleActivityDetail = async (id: number, suppressSettledWarning = false) => {
        if (!easyBetContract) return;
        setSettleOptionsLoading(true);
        try {
            const exists = await easyBetContract.methods.activityExists(id).call();
            if (!exists) {
                message.warning('没有找到这个竞猜，可能已经结束啦');
                setSettleActivityDetail(null);
                return;
            }
            const res: any = await easyBetContract.methods.getActivityDetail(id).call();
            const settled = Boolean(res[5]);
            if (settled) {
                if (!suppressSettledWarning) {
                    message.warning('这个竞猜已经结算啦，无需再次操作');
                }
                setSettleActivityDetail(null);
                return;
            }
            const detail: ActivityDetailView = {
                id,
                creator: res[0],
                deadline: Number(res[1]),
                deadlineText: new Date(Number(res[1]) * 1000).toLocaleString(),
                choices: res[2],
                initialPoolEth: web3.utils.fromWei(res[3], 'ether'),
                totalPoolEth: web3.utils.fromWei(res[4], 'ether'),
                settled,
                winningChoice: Number(res[6]),
                choiceBetAmountsEth: (res[7] as string[]).map((v) => web3.utils.fromWei(v, 'ether')),
            };
            setSettleActivityDetail(detail);
            setWinningChoiceIndex(detail.choices.length ? '0' : '');
        } catch (error: any) {
            console.error('fetchSettleActivityDetail', error);
            message.error(error?.message || '结算信息加载失败，请稍后再试');
            setSettleActivityDetail(null);
        } finally {
            setSettleOptionsLoading(false);
        }
    };

    const handleBuyActivityIdChange = async (value: string) => {
        setBuyActivityId(value);
        setBuyChoiceIndex('');
        setBetActivityDetail(null);
        if (!value) return;
        const idNum = Number(value);
        if (!Number.isFinite(idNum) || idNum <= 0) {
            message.warning('请输入合法的活动 ID');
            return;
        }
        await fetchBetActivityDetail(idNum);
    };

    const handleSettleActivityIdChange = async (value: string) => {
        setSettleActivityId(value);
        setWinningChoiceIndex('');
        setSettleActivityDetail(null);
        if (!value) return;
        const idNum = Number(value);
        if (!Number.isFinite(idNum) || idNum <= 0) {
            message.warning('请输入正确的竞猜编号');
            return;
        }
        await fetchSettleActivityDetail(idNum);
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

        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
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
                if (rv.activityId !== undefined) {
                    id = rv.activityId;
                } else {
                    id = rv[0];
                }
            }
            setStatus('Activity created id: ' + id);
            message.success(`活动创建成功，您的活动编号是 ${id}，祝您好运！`);
            try {
                if (easyBetContract) {
                    const allIds: string[] = await easyBetContract.methods.getAllActivityIds().call();
                    await loadActivityDetails(allIds.map((i: any) => Number(i)));
                    setShowOnlyMyActivities(false);
                }
            } catch (err) {
                console.error('refresh myActivities after createActivity failed', err);
            }
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 买票（下注并铸造 ERC721 票据），value 为 ETH
    const buyTicket = async () => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        if (!buyActivityId) { message.warning('请输入活动 ID'); return; }
        if (buyChoiceIndex === '') { message.warning('请先选择投注选项'); return; }
        try {
            const value = web3.utils.toWei(buyAmountEth, 'ether');
            const tx = await easyBetContract.methods
                .buyTicket(Number(buyActivityId), Number(buyChoiceIndex))
                .send({ from: account, value });
            setStatus('Ticket bought tx: ' + tx.transactionHash);
            message.success('Ticket bought, tx: ' + tx.transactionHash);
            try {
                const ids: string[] = await easyBetContract.methods.getAllActivityIds().call();
                await loadActivityDetails(ids.map((s: any) => Number(s)));
                await fetchBetActivityDetail(Number(buyActivityId));
            } catch (refreshError) {
                console.error('refresh after buyTicket', refreshError);
            }
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 上架票据（先 approve 本合约，再调用 listTicket）
    const listTicket = async () => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const tokenId = Number(listTokenId);
            const contractAddress = easyBetContract.options.address;
            // owner 调用 approve（ERC721 自带）
            await easyBetContract.methods.approve(contractAddress, tokenId).send({ from: account });
            await easyBetContract.methods.listTicket(tokenId, web3.utils.toWei(listPriceEth, 'ether')).send({ from: account });
            setStatus('Ticket listed: ' + tokenId);
            message.success('Ticket listed: ' + tokenId);
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 取消挂单
    const cancelListing = async () => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            await easyBetContract.methods.cancelListing(Number(cancelTokenId)).send({ from: account });
            setStatus('Listing canceled: ' + cancelTokenId);
            message.success('Listing canceled: ' + cancelTokenId);
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 购买挂单票据（需要发送 exact price）
    const buyListedTicket = async () => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const l = await easyBetContract.methods.getListing(Number(buyListedTokenId)).call();
            if (!l || !l.exists) { message.warning('No listing'); return; }
            const price = l.price;
            await easyBetContract.methods.buyListedTicket(Number(buyListedTokenId)).send({ from: account, value: price });
            setStatus('Bought listed ticket ' + buyListedTokenId);
            message.success('Bought listed ticket ' + buyListedTokenId);
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 结算活动（owner 调用）
    const settleActivity = async () => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        if (!settleActivityId) { message.warning('请先填写需要结算的竞猜编号'); return; }
        if (winningChoiceIndex === '') { message.warning('请先选择本次结算的胜出选项'); return; }
        try {
            await easyBetContract.methods.settleActivity(Number(settleActivityId), Number(winningChoiceIndex)).send({ from: account });
            setStatus('Activity settled: ' + settleActivityId);
            message.success(`竞猜结算完成，编号 ${settleActivityId}`);
            const ids: string[] = await easyBetContract.methods.getAllActivityIds().call();
            await loadActivityDetails(ids.map((s: any) => Number(s)));
            await fetchSettleActivityDetail(Number(settleActivityId), true);
            setSettleActivityDetail(null);
            setWinningChoiceIndex('');
        } catch (e: any) {
            message.error(`结算失败：${e?.message || String(e)}`);
        }
    };

    // 查询活动（选择数量 + 活动票据 id 列表）
    const getActivityInfo = async () => {
        if (!queryActivityId) { message.warning('请输入活动 id'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const exists = await easyBetContract.methods.activityExists(Number(queryActivityId)).call();
            if (!exists) { message.warning('Activity not exists'); return; }
            const choicesCount = await easyBetContract.methods.getChoicesCount(Number(queryActivityId)).call();
            const ticketIds = await easyBetContract.methods.getActivityTicketIds(Number(queryActivityId)).call();
            setActivityInfo({ choicesCount: Number(choicesCount), ticketIds });
            setStatus('Fetched activity info');
            message.success('Fetched activity info');
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 查询票据信息（activityId, choiceIndex, amount）
    const getTicketInfo = async () => {
        if (!queryTokenId) { message.warning('请输入 ticket id'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const info = await easyBetContract.methods.getTicketInfo(Number(queryTokenId)).call();
            setTicketInfo(info);
            setStatus('Fetched ticket info');
            message.success('Fetched ticket info');
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 查询挂单信息
    const getListing = async () => {
        if (!queryListingTokenId) { message.warning('请输入 token id'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const l = await easyBetContract.methods.getListing(Number(queryListingTokenId)).call();
            setListingInfo(l);
            setStatus('Fetched listing info');
            message.success('Fetched listing info');
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // Owner 提取合约余额（示例）
    const withdraw = async (amountEth: string) => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const wei = web3.utils.toWei(amountEth, 'ether');
            await easyBetContract.methods.withdraw(wei).send({ from: account });
            setStatus('Withdraw done');
            message.success('Withdraw done');
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // ========== 报价相关：合约调用实现 ==========
    // 获取某 token 的所有报价（调用合约 getOffers）
    const fetchOffersForToken = async (tokenId: number) => {
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const res = await easyBetContract.methods.getOffers(tokenId).call();
            const bidders = res[0] as string[]; // addresses
            const pricesWei = res[1] as string[]; // wei strings
            const prices = pricesWei.map((p: string) => web3.utils.fromWei(p, 'ether'));
            setSelectedListingOffers({ bidders, prices });
            setStatus(`Fetched ${bidders.length} offers for token ${tokenId}`);
        } catch (e: any) {
            console.error('fetchOffersForToken', e);
            message.error(e.message || '获取报价失败');
        }
    };

    // 提交报价（调用合约 makeOffer 并附带 ETH）
    const makeOffer = async (tokenId: number, priceEth: string) => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const value = web3.utils.toWei(priceEth, 'ether');
            await easyBetContract.methods.makeOffer(tokenId).send({ from: account, value });
            message.success('报价已提交');
            await fetchOffersForToken(tokenId);
        } catch (e: any) {
            console.error('makeOffer', e);
            message.error(e.message || String(e));
        }
    };

    // 撤回自己的报价（调用合约 withdrawOffer）
    const withdrawOffer = async (tokenId: number, index: number) => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            await easyBetContract.methods.withdrawOffer(tokenId, index).send({ from: account });
            message.success('报价已撤回');
            await fetchOffersForToken(tokenId);
        } catch (e: any) {
            console.error('withdrawOffer', e);
            message.error(e.message || String(e));
        }
    };

    // 卖家接受某个报价（调用合约 acceptOffer）
    const acceptOffer = async (tokenId: number, index: number) => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            await easyBetContract.methods.acceptOffer(tokenId, index).send({ from: account });
            message.success('已接受报价并完成交易');
            // 刷新我的票据与市场挂单
            try {
                const tickets = await easyBetContract.methods.getTicketsByOwner(account).call();
                setMyTickets((tickets as string[]).map(t => Number(t)));
            } catch (_) { /* ignore */ }
            try {
                const m = await easyBetContract.methods.getAllListings().call();
                const tokenIds = m[0] as string[]; const sellers = m[1] as string[]; const prices = m[2] as string[];
                setMarketListings(tokenIds.map((t, i) => ({ tokenId: Number(t), seller: sellers[i], priceWei: prices[i] })));
                // 更新我的挂单过滤
                const mine = tokenIds
                    .map((t, i) => ({ tokenId: Number(t), seller: sellers[i], priceWei: prices[i] }))
                    .filter(a => a.seller.toLowerCase() === account.toLowerCase())
                    .map(a => ({ tokenId: a.tokenId, price: web3.utils.fromWei(a.priceWei, 'ether') }));
                setMyListings(mine);
            } catch (_) { /* ignore */ }
            // 刷新当前选中报价列表
            await fetchOffersForToken(tokenId);
        } catch (e: any) {
            console.error('acceptOffer', e);
            message.error(e.message || String(e));
        }
    };

    // 简单的页面布局，仅包含 EasyBet 功能入口
    return (
        // 使用 .container CSS 类管理布局与顶部对齐（避免被父级 flex 居中）
        <div className="container">
            {/* header */}
            <div className="header">
                <img src={logo} alt="logo" className="logo" />
                <div className="title">EasyBet</div>
            </div>

            {/* account row */}
            <div className="account-row">
                <div className="account-text">当前账户地址: <span className="account-value">{account || '未连接'}</span></div>
                <div className={`status ${account ? 'connected' : 'disconnected'}`}>{account ? '已连接' : '未连接'}</div>
                <Button onClick={connectWallet}>{account ? '重新连接' : '连接钱包'}</Button>
            </div>

            {/* ========== 1. 竞猜 ========== */}
            <Divider>1.竞猜</Divider>
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{ fontWeight: 600 }}>已有竞猜</div>
                    <Checkbox
                        checked={showOnlyMyActivities}
                        onChange={(e) => setShowOnlyMyActivities(e.target.checked)}
                    >
                        我的活动
                    </Checkbox>
                </div>
                <Table
                    style={{ marginBottom: 20 }}
                    size="small"
                    columns={activityColumns}
                    dataSource={activityTableData}
                    rowKey="id"
                    pagination={false}
                    loading={activitiesLoading}
                    locale={{ emptyText: '暂无活动' }}
                />

                <div style={{ fontWeight: 600, marginBottom: 8 }}>创建竞猜</div>
                <div
                    style={{
                        marginBottom: 16,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap'
                    }}
                >
                    <span>选项 (逗号分隔)：</span>
                    <Input value={choicesCsv} onChange={e => setChoicesCsv(e.target.value)} style={{ width: 180 }} />
                    <span>截止时间（分钟后）：</span>
                    <Input value={deadlineMinutes} onChange={e => setDeadlineMinutes(Number(e.target.value))} style={{ width: 50 }} />
                    <span>初始奖池 (ETH)：</span>
                    <Input value={initialPoolEth} onChange={e => setInitialPoolEth(e.target.value)} style={{ width: 50 }} />
                    <Button type="primary" onClick={createActivity}>创建活动</Button>
                </div>

                <div style={{ fontWeight: 600, marginBottom: 8 }}>下注</div>
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <Input
                        placeholder="活动ID"
                        value={buyActivityId}
                        onChange={(e) => handleBuyActivityIdChange(e.target.value)}
                        style={{ width: 200 }}
                    />
                    <Input
                        placeholder="金额 ETH"
                        value={buyAmountEth}
                        onChange={(e) => setBuyAmountEth(e.target.value)}
                        style={{ width: 200 }}
                    />
                    <Button
                        type="primary"
                        onClick={buyTicket}
                        disabled={betDisabled}
                        style={betButtonStyle}
                    >
                        下注并铸票
                    </Button>
                </div>
                {betActivityDetail && (
                    <div style={{ marginBottom: 8, color: '#666' }}>
                        当前奖池总额：{betActivityDetail.totalPoolEth} ETH
                    </div>
                )}
                <Table
                    size="small"
                    columns={[
                        { title: '选项编号', dataIndex: 'index', key: 'index', width: 100, align: 'center' },
                        { title: '选项名称', dataIndex: 'name', key: 'name', align: 'center' },
                        { title: '当前奖池 (ETH)', dataIndex: 'pool', key: 'pool', align: 'center' },
                        { title: '预期收益倍数', dataIndex: 'profit', key: 'profit', align: 'center' },
                    ]}
                    dataSource={betOptionsData}
                    pagination={false}
                    loading={betOptionsLoading}
                    rowSelection={betOptionsRowSelection}
                    locale={{ emptyText: buyActivityId ? '暂无选项' : '请输入活动 ID 查看选项' }}
                    style={{ marginBottom: 16 }}
                />

                <div style={{ fontWeight: 600, marginBottom: 8 }}>结算竞猜</div>
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <Input
                        placeholder="活动ID"
                        value={settleActivityId}
                        onChange={(e) => handleSettleActivityIdChange(e.target.value)}
                        style={{ width: 200 }}
                    />
                    <Button
                        type="primary"
                        onClick={settleActivity}
                        disabled={settleDisabled}
                        style={settleButtonStyle}
                    >
                        结算活动
                    </Button>
                </div>
                {settleActivityDetail && (
                    <div style={{ marginBottom: 8, color: '#666' }}>
                        当前奖池总额：{settleActivityDetail.totalPoolEth} ETH
                    </div>
                )}
                <Table
                    size="small"
                    columns={[
                        { title: '选项编号', dataIndex: 'index', key: 'index', width: 100, align: 'center' },
                        { title: '选项名称', dataIndex: 'name', key: 'name', align: 'center' },
                        { title: '当前奖池 (ETH)', dataIndex: 'pool', key: 'pool', align: 'center' },
                    ]}
                    dataSource={settleOptionsData}
                    pagination={false}
                    loading={settleOptionsLoading}
                    rowSelection={settleOptionsRowSelection}
                    locale={{ emptyText: settleActivityId ? '暂无选项' : '请输入活动 ID 查看选项' }}
                    style={{ marginBottom: 16 }}
                />
            </div>

            {/* ========== 2. 我的 ========== */}
            <Divider>2. 我的（自动查询我创建的活动 & 我持有的票）</Divider>
            <div>
                <div style={{ marginTop: 12 }}>
                    <div>我持有的票：</div>
                    {myTickets.length === 0 ? <div>-</div> : (
                        <List size="small" bordered dataSource={myTickets} renderItem={(tid) => (
                            <List.Item>{`Ticket ${tid}`}</List.Item>
                        )} />
                    )}
                </div>

                <div style={{ marginTop: 12 }}>
                    <div>我的挂单（来自市场过滤）：</div>
                    {myListings.length === 0 ? <div>-</div> : (
                        <List size="small" bordered dataSource={myListings} renderItem={(it) => (
                            <List.Item>{`Token ${it.tokenId} - Price ${it.price} ETH`}</List.Item>
                        )} />
                    )}
                </div>
            </div>

            {/* ========== 3. 交易 ========== */}
            <Divider>3. 交易（市场挂单 / 报价 / 我的交易）</Divider>
            <div>
                {/* 市场挂单展示 */}
                <div>
                    <div>市场挂单：</div>
                    {marketListings.length === 0 ? <div>-</div> : (
                        <List size="small" bordered dataSource={marketListings} renderItem={(it) => (
                            <List.Item actions={[
                                <Button onClick={() => { setOfferTokenId(String(it.tokenId)); fetchOffersForToken(it.tokenId); }}>查看报价</Button>,
                                <Button onClick={() => { setOfferTokenId(String(it.tokenId)); setOfferPriceEth('0.01'); }}>报价</Button>
                            ]}>
                                {`Token ${it.tokenId} | Seller: ${it.seller} | Price: ${web3.utils.fromWei(it.priceWei, 'ether')} ETH`}
                            </List.Item>
                        )} />
                    )}
                </div>

                {/* 报价区域（对选定 tokenId 提交报价） */}
                <div style={{ marginTop: 12 }}>
                    <Input placeholder="tokenId" value={offerTokenId} onChange={e => setOfferTokenId(e.target.value)} style={{ width: 200 }} />
                    <Input placeholder="报价 ETH" value={offerPriceEth} onChange={e => setOfferPriceEth(e.target.value)} style={{ width: 200, marginLeft: 8 }} />
                    <Button onClick={() => makeOffer(Number(offerTokenId), offerPriceEth)} style={{ marginLeft: 8 }}>提交报价</Button>
                </div>

                {/* 查看并操作报价（如果已加载） */}
                <div style={{ marginTop: 12 }}>
                    <div>已选挂单报价：</div>
                    {selectedListingOffers ? (
                        <List size="small" bordered dataSource={selectedListingOffers.bidders.map((b, i) => ({ b, p: selectedListingOffers.prices[i], idx: i }))} renderItem={(it) => (
                            <List.Item actions={[
                                it.b.toLowerCase() === account.toLowerCase() ? <Button onClick={() => withdrawOffer(Number(offerTokenId), it.idx)}>撤回我的报价</Button> : null,
                                // 如果当前用户是卖家则显示接受按钮
                                (marketListings.find(m => m.tokenId === Number(offerTokenId))?.seller.toLowerCase() === account.toLowerCase()) ?
                                    <Button onClick={() => acceptOffer(Number(offerTokenId), it.idx)}>接受该报价</Button> : null
                            ]}>
                                {`Bidder: ${it.b} | Price: ${it.p} ETH`}
                            </List.Item>
                        )} />
                    ) : <div>-</div>}
                </div>
            </div>

            <Divider>状态</Divider>
            <div>{status}</div>
        </div>
    );
};

export default LotteryPage;