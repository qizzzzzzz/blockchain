import { Button, Divider, Input, message, List, Table, Tag, Checkbox } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState, useCallback } from 'react';
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
    content: string;
};

type MyTicketDetail = {
    tokenId: number;
    activityId: number;
    content: string;
    deadline: number;
    deadlineText: string;
    choices: string[];
    choiceBetAmountsEth: string[];
    myChoiceIndex: number;
    myChoiceName: string;
    myBetAmountEth: string;
    winningChoiceIndex: number;
    winningChoiceName: string;
    totalPoolEth: string;
    settled: boolean;
    order: number;
};

const LotteryPage = () => {
    const [account, setAccount] = useState<string>('');
    const [status, setStatus] = useState<string>('');
    // 创建活动
    const [choicesCsv, setChoicesCsv] = useState<string>('TeamA,TeamB');
    const [deadlineMinutes, setDeadlineMinutes] = useState<number>(60);
    const [initialPoolEth, setInitialPoolEth] = useState<string>('0.1');
    const [activityContent, setActivityContent] = useState<string>('A vs B');
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
    const [myTicketDetails, setMyTicketDetails] = useState<MyTicketDetail[]>([]);
    const [myTicketsLoading, setMyTicketsLoading] = useState<boolean>(false);
    const [myListings, setMyListings] = useState<{ tokenId: number; price: string }[]>([]);
    const [marketListings, setMarketListings] = useState<{ tokenId: number; seller: string; priceWei: string }[]>([]);
    // 移除：买家报价相关状态
    // const [selectedListingOffers, setSelectedListingOffers] = useState<{ bidders: string[]; prices: string[] } | null>(null);
    // const [offerTokenId, setOfferTokenId] = useState<string>('');
    // const [offerPriceEth, setOfferPriceEth] = useState<string>('0.01');
    const [allActivityDetails, setAllActivityDetails] = useState<ActivityDetailView[]>([]);
    const [showOnlyMyActivities, setShowOnlyMyActivities] = useState<boolean>(false);
    const [activitiesLoading, setActivitiesLoading] = useState<boolean>(false);
    const [betActivityDetail, setBetActivityDetail] = useState<ActivityDetailView | null>(null);
    const [betOptionsLoading, setBetOptionsLoading] = useState<boolean>(false);
    const [settleActivityDetail, setSettleActivityDetail] = useState<ActivityDetailView | null>(null);
    const [settleOptionsLoading, setSettleOptionsLoading] = useState<boolean>(false);
    const activityColumns: ColumnsType<ActivityDetailView> = [
        { title: '竞猜ID', dataIndex: 'id', key: 'id', width: 80, align: 'center' },
        { title: '竞猜内容', dataIndex: 'content', key: 'content', width: 300, align: 'center' },
        {
            title: '创建者',
            key: 'creator',
            width: 100,
            align: 'center',
            render: (_: any, record: ActivityDetailView) =>
                account && record.creator.toLowerCase() === account.toLowerCase() ? '我' : '其他',
        },
        { title: '截止时间', dataIndex: 'deadlineText', key: 'deadline', width: 150, align: 'center' },
        {
            title: '选项 & 累计下注 (ETH)',
            key: 'choices',
            width: 250,
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
            width: 100,
            align: 'center',
            render: (_: any, record: ActivityDetailView) =>
                record.settled ? (record.choices[record.winningChoice] ?? `索引 ${record.winningChoice}`) : '-',
        },
        {
            title: '奖池金额 (ETH)',
            dataIndex: 'totalPoolEth',
            key: 'totalPoolEth',
            width: 150,
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

    const myTicketColumns: ColumnsType<MyTicketDetail> = [
        { title: '序号', dataIndex: 'order', key: 'order', width: 70, align: 'center' },
        { title: '竞猜内容', dataIndex: 'content', key: 'content', width: 220, align: 'center' },
        { title: '截止时间', dataIndex: 'deadlineText', key: 'deadlineText', width: 150, align: 'center' },
        {
            title: '选项 & 累计下注 (ETH)',
            key: 'choicesSummary',
            width: 250,
            align: 'center',
            render: (_: any, record: MyTicketDetail) => (
                <div>
                    {record.choices.map((choice, idx) => (
                        <div key={idx}>{`${choice}：${record.choiceBetAmountsEth[idx] ?? '0'}`}</div>
                    ))}
                </div>
            ),
        },
        { title: '我的选择', dataIndex: 'myChoiceName', key: 'myChoiceName', width: 140, align: 'center' },
        { title: '下注金额 (ETH)', dataIndex: 'myBetAmountEth', key: 'myBetAmountEth', width: 140, align: 'center' },
        { title: '获胜选项', dataIndex: 'winningChoiceName', key: 'winningChoiceName', width: 160, align: 'center' },
        { title: '奖池金额 (ETH)', dataIndex: 'totalPoolEth', key: 'totalPoolEth', width: 150, align: 'center' },
        {
            title: '状态',
            key: 'status',
            width: 120,
            align: 'center',
            render: (_: any, record: MyTicketDetail) =>
                record.settled ? <Tag color="green">已结算</Tag> : <Tag color="blue">进行中</Tag>,
        },
    ];

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

    const refreshMyTickets = useCallback(async () => {
        if (!easyBetContract || !account) {
            setMyTicketDetails([]);
            setMyTicketsLoading(false);
            return;
        }
        setMyTicketsLoading(true);
        try {
            const tokenIds: string[] = await easyBetContract.methods.getTicketsByOwner(account).call();
            if (!tokenIds.length) {
                setMyTicketDetails([]);
                return;
            }

            const detailList = await Promise.all(
                tokenIds.map(async (tid: string, idx: number) => {
                    const tokenId = Number(tid);
                    const ticketRes: any = await easyBetContract.methods.tickets(tokenId).call();
                    const activityId = Number(ticketRes.activityId ?? ticketRes[0]);
                    const choiceIndex = Number(ticketRes.choiceIndex ?? ticketRes[1]);
                    const amountWei = ticketRes.amount ?? ticketRes[2];
                    const activityRes: any = await easyBetContract.methods.getActivityDetail(activityId).call();
                    const {
                        deadline,
                        content,
                        choices,
                        totalPool,
                        settled,
                        winningChoice,
                        choiceBetAmounts
                    } = activityRes;
                    const deadlineNum = Number(deadline);
                    const choicesArray = (choices as string[]) ?? [];
                    const choiceBetAmountsArray = (choiceBetAmounts as string[]) ?? [];
                    const choiceBetAmountsEth = choiceBetAmountsArray.map((v) => web3.utils.fromWei(v, 'ether'));
                    const myBetAmountEth = web3.utils.fromWei(amountWei, 'ether');
                    const totalPoolEth = web3.utils.fromWei(totalPool, 'ether');
                    const winningChoiceIndex = Number(winningChoice);
                    return {
                        tokenId,
                        activityId,
                        content,
                        deadline: deadlineNum,
                        deadlineText: new Date(deadlineNum * 1000).toLocaleString(),
                        choices: choicesArray,
                        choiceBetAmountsEth,
                        myChoiceIndex: choiceIndex,
                        myChoiceName: choicesArray[choiceIndex] ?? `选项 ${choiceIndex}`,
                        myBetAmountEth,
                        winningChoiceIndex,
                        winningChoiceName: settled ? (choicesArray[winningChoiceIndex] ?? `选项 ${winningChoiceIndex}`) : '-',
                        totalPoolEth,
                        settled: Boolean(settled),
                        order: idx + 1,
                    } as MyTicketDetail;
                })
            );
            setMyTicketDetails(detailList);
        } catch (error) {
            console.error('refreshMyTickets', error);
            setMyTicketDetails([]);
        } finally {
            setMyTicketsLoading(false);
        }
    }, [account, easyBetContract]);

    useEffect(() => {
        refreshMyTickets();
    }, [refreshMyTickets]);

    // 新增：加载市场挂单（仅 Listing）
    const refreshMarketListings = useCallback(async () => {
        if (!easyBetContract) {
            setMarketListings([]);
            setMyListings([]);
            return;
        }
        try {
            const m = await easyBetContract.methods.getAllListings().call();
            const tokenIds = m[0] as string[];
            const sellers = m[1] as string[];
            const prices = m[2] as string[];
            const items = tokenIds.map((t, i) => ({
                tokenId: Number(t),
                seller: sellers[i],
                priceWei: prices[i],
            }));
            setMarketListings(items);
            if (account) {
                const mine = items
                    .filter((a) => a.seller.toLowerCase() === account.toLowerCase())
                    .map((a) => ({ tokenId: a.tokenId, price: web3.utils.fromWei(a.priceWei, 'ether') }));
                setMyListings(mine);
            } else {
                setMyListings([]);
            }
        } catch (e) {
            console.error('refreshMarketListings', e);
        }
    }, [easyBetContract, account]);

    useEffect(() => {
        refreshMarketListings();
    }, [refreshMarketListings]);

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
                    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: GanacheTestChainId }] });
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
            const acct = accounts && accounts[0] ? accounts[0] : '';
            setAccount(acct);
            setStatus(acct ? '已连接' : '未找到账户');
            if (acct) {
                message.success(`钱包已连接：${acct}`);
                await refreshMyTickets();
            } else {
                message.warning('已连接但未返回账户。请在钱包中解锁并授权本网站后重试。');
            }
        } catch (err: any) {
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
                    const {
                        creator,
                        deadline,
                        content,
                        choices,
                        initialPool,
                        totalPool,
                        settled,
                        winningChoice,
                        choiceBetAmounts
                    } = res;
                    return {
                        id,
                        creator,
                        deadline: Number(deadline),
                        deadlineText: new Date(Number(deadline) * 1000).toLocaleString(),
                        content,
                        choices,
                        initialPoolEth: web3.utils.fromWei(initialPool, 'ether'),
                        totalPoolEth: web3.utils.fromWei(totalPool, 'ether'),
                        settled,
                        winningChoice: Number(winningChoice),
                        choiceBetAmountsEth: (choiceBetAmounts as string[]).map((v) =>
                            web3.utils.fromWei(v, 'ether')
                        ),
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
                message.warning('竞猜不存在或已被移除');
                setBetActivityDetail(null);
                return;
            }
            const res: any = await easyBetContract.methods.getActivityDetail(id).call();
            const {
                creator,
                deadline,
                content,
                choices,
                initialPool,
                totalPool,
                settled,
                winningChoice,
                choiceBetAmounts
            } = res;
            const now = Math.floor(Date.now() / 1000);
            if (settled) {
                message.warning('该竞猜已结算，无法继续下注');
                setBetActivityDetail(null);
                return;
            }
            if (Number(deadline) <= now) {
                message.warning('该竞猜已超过截止时间，无法继续下注');
                setBetActivityDetail(null);
                return;
            }
            const detail: ActivityDetailView = {
                id,
                creator,
                deadline: Number(deadline),
                deadlineText: new Date(Number(deadline) * 1000).toLocaleString(),
                content,
                choices,
                initialPoolEth: web3.utils.fromWei(initialPool, 'ether'),
                totalPoolEth: web3.utils.fromWei(totalPool, 'ether'),
                settled,
                winningChoice: Number(winningChoice),
                choiceBetAmountsEth: (choiceBetAmounts as string[]).map((v) => web3.utils.fromWei(v, 'ether')),
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
            message.error(error?.message || '加载竞猜详情失败');
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
            const {
                creator,
                deadline,
                content,
                choices,
                initialPool,
                totalPool,
                settled,
                winningChoice,
                choiceBetAmounts
            } = res;
            if (settled) {
                if (!suppressSettledWarning) {
                    message.warning('这个竞猜已经结算啦，无需再次操作');
                }
                setSettleActivityDetail(null);
                return;
            }
            const detail: ActivityDetailView = {
                id,
                creator,
                deadline: Number(deadline),
                deadlineText: new Date(Number(deadline) * 1000).toLocaleString(),
                content,
                choices,
                initialPoolEth: web3.utils.fromWei(initialPool, 'ether'),
                totalPoolEth: web3.utils.fromWei(totalPool, 'ether'),
                settled,
                winningChoice: Number(winningChoice),
                choiceBetAmountsEth: (choiceBetAmounts as string[]).map((v) => web3.utils.fromWei(v, 'ether')),
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
            message.warning('请输入合法的竞猜 ID');
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
            const content = activityContent.trim();
            if (!content) { message.warning('请填写竞猜内容'); return; }
            const choices = choicesCsv.split(',').map(s => s.trim()).filter(s => s.length);
            const deadline = Math.floor(Date.now() / 1000) + Number(deadlineMinutes) * 60;
            const value = web3.utils.toWei(initialPoolEth, 'ether');
            const receipt: TransactionReceipt = await easyBetContract.methods
                .createActivity(content, choices, deadline)
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
            setStatus('竞猜创建 ID: ' + id);
            message.success(`竞猜创建成功，编号 ${id}，祝您好运！`);
            setActivityContent('A vs B');
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
        if (!buyActivityId) { message.warning('请输入竞猜 ID'); return; }
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
                await refreshMyTickets();
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
            await refreshMarketListings();
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 取消挂单（支持直接传入 tokenId）
    const cancelListing = async (tokenIdParam?: number) => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const id = tokenIdParam ?? Number(cancelTokenId);
            await easyBetContract.methods.cancelListing(id).send({ from: account });
            setStatus('Listing canceled: ' + id);
            message.success('Listing canceled: ' + id);
            await refreshMarketListings();
        } catch (e: any) {
            message.error(e.message || String(e));
        }
    };

    // 购买挂单票据（支持直接传入 tokenId，需发送 exact price）
    const buyListedTicket = async (tokenIdParam?: number) => {
        if (!account) { message.warning('请先连接钱包'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const id = tokenIdParam ?? Number(buyListedTokenId);
            const l = await easyBetContract.methods.getListing(id).call();
            if (!l || !l.exists) { message.warning('No listing'); return; }
            const price = l.price;
            await easyBetContract.methods.buyListedTicket(id).send({ from: account, value: price });
            setStatus('Bought listed ticket ' + id);
            message.success('Bought listed ticket ' + id);
            await refreshMyTickets();
            await refreshMarketListings();
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
            await easyBetContract.methods
                .settleActivity(Number(settleActivityId), Number(winningChoiceIndex))
                .send({ from: account });

            setStatus('竞猜结算: ' + settleActivityId);
            message.success(`竞猜结算完成，编号 ${settleActivityId}`);

            const ids: string[] = await easyBetContract.methods.getAllActivityIds().call();
            await loadActivityDetails(ids.map((s: any) => Number(s)));
            await fetchSettleActivityDetail(Number(settleActivityId), true);

            setSettleActivityDetail(null);
            setWinningChoiceIndex('');
            await refreshMyTickets();
        } catch (e: any) {
            message.error(`结算失败：${e?.message || String(e)}`);
        }
    };

    // 查询活动（选择数量 + 活动票据 id 列表）
    const getActivityInfo = async () => {
        if (!queryActivityId) { message.warning('请输入竞猜 id'); return; }
        if (!easyBetContract) { message.error('Contract not available'); return; }
        try {
            const exists = await easyBetContract.methods.activityExists(Number(queryActivityId)).call();
            if (!exists) { message.warning('竞猜不存在'); return; }
            const choicesCount = await easyBetContract.methods.getChoicesCount(Number(queryActivityId)).call();
            const ticketIds = await easyBetContract.methods.getActivityTicketIds(Number(queryActivityId)).call();
            setActivityInfo({ choicesCount: Number(choicesCount), ticketIds });
            setStatus('已获取竞猜信息');
            message.success('已获取竞猜信息');
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
    // 已移除：根据合约当前版本仅支持 listing，不支持报价/offer
    // function fetchOffersForToken(...) { ... }
    // function makeOffer(...) { ... }
    // function withdrawOffer(...) { ... }
    // function acceptOffer(...) { ... }

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
            <Divider><span className="main-section-title">1.竞猜</span></Divider>
            <div>
                <div className="sub-section">
                    <div className="sub-section-title-row">
                        <span>已有竞猜</span>
                        <Checkbox
                            className="sub-section-title-right"
                            checked={showOnlyMyActivities}
                            onChange={(e) => setShowOnlyMyActivities(e.target.checked)}
                        >
                            只看我创建的竞猜
                        </Checkbox>
                    </div>
                    <Table
                        bordered
                        style={{ marginBottom: 20 }}
                        size="small"
                        columns={activityColumns}
                        dataSource={activityTableData}
                        rowKey="id"
                        pagination={false}
                        loading={activitiesLoading}
                        locale={{ emptyText: '暂无竞猜' }}
                    />
                </div>

                <div className="sub-section">
                    <div className="sub-section-title">创建竞猜</div>
                    <div className="sub-section-body create-section_body">
                        <div className="create-section-row">
                            <span>竞猜内容：</span>
                            <Input
                                value={activityContent}
                                onChange={e => setActivityContent(e.target.value)}
                                style={{ width: 250 }}
                            />
                            <span>选项 (逗号分隔)：</span>
                            <Input value={choicesCsv} onChange={e => setChoicesCsv(e.target.value)} style={{ width: 250 }} />
                        </div>
                        <div className="create-section-row">
                            <span>截止时间（分钟后）：</span>
                            <Input value={deadlineMinutes} onChange={e => setDeadlineMinutes(Number(e.target.value))} style={{ width: 200 }} />
                            <span>初始奖池 (ETH)：</span>
                            <Input value={initialPoolEth} onChange={e => setInitialPoolEth(e.target.value)} style={{ width: 200 }} />
                            <Button type="primary" onClick={createActivity}>创建竞猜</Button>
                        </div>
                    </div>
                </div>

                <div className="sub-section">
                    <div className="sub-section-title">下注</div>
                    <div className="sub-section-body">
                        <Input
                            placeholder="竞猜ID"
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
                        bordered
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
                        locale={{ emptyText: buyActivityId ? '暂无选项' : '请输入竞猜 ID 查看选项' }}
                        style={{ marginBottom: 16 }}
                    />

                    <Divider dashed />

                    <div className="sub-section-title">结算竞猜</div>
                    <div className="sub-section-body">
                        <Input
                            placeholder="竞猜ID"
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
                        bordered
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
                        locale={{ emptyText: settleActivityId ? '暂无选项' : '请输入竞猜 ID 查看选项' }}
                        style={{ marginBottom: 16 }}
                    />
                </div>
            </div>

            {/* ========== 2. 我的 ========== */}
            <Divider><span className="main-section-title">2. 我的</span></Divider>
            <div>
                <div className="sub-section">
                    <div className="sub-section-title">我持有的票：</div>
                    <Table
                        bordered
                        size="small"
                        columns={myTicketColumns}
                        dataSource={myTicketDetails}
                        rowKey="tokenId"
                        pagination={false}
                        loading={myTicketsLoading}
                        locale={{ emptyText: account ? '暂无票据' : '请先连接钱包' }}
                    />
                </div>

                <div className="sub-section">
                    <div className="sub-section-title">我的挂单（来自市场过滤）：</div>
                    {myListings.length === 0 ? <div>-</div> : (
                        <List size="small" bordered dataSource={myListings} renderItem={(it) => (
                            <List.Item>{`Token ${it.tokenId} - Price ${it.price} ETH`}</List.Item>
                        )} />
                    )}
                </div>
            </div>

            {/* ========== 3. 交易 ========== */}
            <Divider><span className="main-section-title">3. 交易</span></Divider>
            <div>
                {/* 市场挂单（仅 Listing） */}
                <div className="sub-section">
                    <div className="sub-section-title">
                        市场挂单：
                        <Button style={{ marginLeft: 8 }} onClick={refreshMarketListings}>刷新</Button>
                    </div>
                    {marketListings.length === 0 ? <div>-</div> : (
                        <List
                            size="small"
                            bordered
                            dataSource={marketListings}
                            renderItem={(it) => (
                                <List.Item
                                    actions={[
                                        it.seller.toLowerCase() === (account || '').toLowerCase()
                                            ? <Button onClick={() => cancelListing(it.tokenId)}>取消挂单</Button>
                                            : <Button type="primary" onClick={() => buyListedTicket(it.tokenId)}>购买</Button>
                                    ]}
                                >
                                    {`Token ${it.tokenId} | Seller: ${it.seller} | Price: ${web3.utils.fromWei(it.priceWei, 'ether')} ETH`}
                                </List.Item>
                            )}
                        />
                    )}
                </div>

                {/* 我来挂单 */}
                <div className="sub-section">
                    <div className="sub-section-title">我来挂单</div>
                    <div className="sub-section-body">
                        <Input
                            placeholder="tokenId"
                            value={listTokenId}
                            onChange={e => setListTokenId(e.target.value)}
                            style={{ width: 200 }}
                        />
                        <Input
                            placeholder="价格 ETH"
                            value={listPriceEth}
                            onChange={e => setListPriceEth(e.target.value)}
                            style={{ width: 200, marginLeft: 8 }}
                        />
                        <Button type="primary" onClick={listTicket} style={{ marginLeft: 8 }}>上架</Button>
                    </div>
                </div>

                {/* 手动购买 / 取消（可选） */}
                <div className="sub-section">
                    <div className="sub-section-title">手动购买 / 取消</div>
                    <div className="sub-section-body">
                        <Input
                            placeholder="购买 tokenId"
                            value={buyListedTokenId}
                            onChange={e => setBuyListedTokenId(e.target.value)}
                            style={{ width: 200 }}
                        />
                        <Button onClick={() => buyListedTicket()} style={{ marginLeft: 8 }}>购买</Button>
                        <Input
                            placeholder="取消 tokenId"
                            value={cancelTokenId}
                            onChange={e => setCancelTokenId(e.target.value)}
                            style={{ width: 200, marginLeft: 16 }}
                        />
                        <Button danger onClick={() => cancelListing()} style={{ marginLeft: 8 }}>取消挂单</Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LotteryPage;